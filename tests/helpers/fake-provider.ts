import type { Eip1193Event, Eip1193Provider, Eip1193RequestArguments } from '../../src/core/provider.js'

/**
 * A test double for an EIP-1193 wallet.
 *
 * This is not a mock of anything `hood-connect` owns. It stands in for an
 * external interface defined by a public standard, and it implements that
 * standard's real failure modes: 4001 rejection, 4902 unknown chain, -32002
 * request already pending, and the `-32603` wrapper some wallets bury the real
 * code inside. Testing the flow against anything less would only prove the
 * happy path works.
 */

/** Build a provider error with the shape wallets actually reject with. */
export function rpcError(code: number, message: string, data?: unknown): Error & { code: number; data?: unknown } {
  const error = new Error(message) as Error & { code: number; data?: unknown }
  error.code = code
  if (data !== undefined) error.data = data
  return error
}

/** A `-32603` internal error wrapping a real code, as several wallets send. */
export function wrappedRpcError(innerCode: number, message: string): Error & { code: number; data?: unknown } {
  return rpcError(-32603, message, { originalError: { code: innerCode, message } })
}

export interface FakeProviderOptions {
  /** Accounts `eth_accounts` returns. Empty means locked or not authorised. */
  accounts?: string[]
  /** Accounts `eth_requestAccounts` grants. Defaults to `accounts`. */
  grantAccounts?: string[]
  /** Chain the wallet is currently on. */
  chainId?: number
  /** Chains the wallet already knows. Switching to anything else gives 4902. */
  knownChains?: number[]
  /** Native balance in wei, keyed by lowercase address. */
  nativeBalances?: Record<string, bigint>
  /** ERC-20 balance in base units, keyed by lowercase address. */
  tokenBalances?: Record<string, bigint>
  /** Omit `wallet_addEthereumChain` support, as some mobile wallets do. */
  supportsAddChain?: boolean
  /** Omit `wallet_switchEthereumChain` support. */
  supportsSwitchChain?: boolean
  /** Omit `on`/`removeListener` entirely, as a bare provider might. */
  supportsEvents?: boolean
}

export class FakeProvider implements Eip1193Provider {
  accounts: string[]
  grantAccounts: string[]
  chainId: number
  knownChains: Set<number>
  nativeBalances: Record<string, bigint>
  tokenBalances: Record<string, bigint>
  supportsAddChain: boolean
  supportsSwitchChain: boolean

  /** Every request received, in order. The assertion surface for the tests. */
  readonly calls: Eip1193RequestArguments[] = []
  /** Errors queued to be thrown by the next call to a given method. */
  readonly queuedErrors = new Map<string, unknown[]>()
  /** Errors thrown by every call to a given method. */
  readonly persistentErrors = new Map<string, unknown>()

  #listeners = new Map<Eip1193Event, Set<(payload: never) => void>>()
  #supportsEvents: boolean

  constructor(options: FakeProviderOptions = {}) {
    this.accounts = options.accounts ?? []
    this.grantAccounts = options.grantAccounts ?? options.accounts ?? []
    this.chainId = options.chainId ?? 1
    this.knownChains = new Set(options.knownChains ?? [options.chainId ?? 1])
    this.nativeBalances = options.nativeBalances ?? {}
    this.tokenBalances = options.tokenBalances ?? {}
    this.supportsAddChain = options.supportsAddChain ?? true
    this.supportsSwitchChain = options.supportsSwitchChain ?? true
    this.#supportsEvents = options.supportsEvents ?? true

    if (!this.#supportsEvents) {
      delete (this as Partial<Eip1193Provider>).on
      delete (this as Partial<Eip1193Provider>).removeListener
    }
  }

  /** Throw `error` on the next call to `method`, once. */
  failNext(method: string, error: unknown): this {
    const queue = this.queuedErrors.get(method) ?? []
    queue.push(error)
    this.queuedErrors.set(method, queue)
    return this
  }

  /** Throw `error` on every call to `method`. */
  failAlways(method: string, error: unknown): this {
    this.persistentErrors.set(method, error)
    return this
  }

  /** Count how many times a method was requested. */
  countOf(method: string): number {
    return this.calls.filter((call) => call.method === method).length
  }

  async request(args: Eip1193RequestArguments): Promise<unknown> {
    this.calls.push(args)

    const queued = this.queuedErrors.get(args.method)
    if (queued && queued.length > 0) throw queued.shift()
    if (this.persistentErrors.has(args.method)) throw this.persistentErrors.get(args.method)

    switch (args.method) {
      case 'eth_accounts':
        return [...this.accounts]

      case 'eth_requestAccounts':
        this.accounts = [...this.grantAccounts]
        return [...this.accounts]

      case 'eth_chainId':
        return `0x${this.chainId.toString(16)}`

      case 'wallet_addEthereumChain': {
        if (!this.supportsAddChain) throw rpcError(4200, 'wallet_addEthereumChain is not supported')
        const param = (args.params as [{ chainId: string }])[0]
        this.knownChains.add(Number.parseInt(param.chainId, 16))
        return null
      }

      case 'wallet_switchEthereumChain': {
        if (!this.supportsSwitchChain) throw rpcError(4200, 'wallet_switchEthereumChain is not supported')
        const param = (args.params as [{ chainId: string }])[0]
        const requested = Number.parseInt(param.chainId, 16)
        if (!this.knownChains.has(requested)) {
          throw rpcError(4902, `Unrecognized chain ID "${param.chainId}". Try adding the chain first.`)
        }
        this.setChain(requested)
        return null
      }

      case 'eth_getBalance': {
        const address = String((args.params as [string])[0]).toLowerCase()
        return `0x${(this.nativeBalances[address] ?? 0n).toString(16)}`
      }

      case 'eth_call': {
        const call = (args.params as [{ data: string }])[0]
        // `balanceOf(address)` is the only call this package makes.
        const address = `0x${call.data.slice(-40)}`.toLowerCase()
        return `0x${(this.tokenBalances[address] ?? 0n).toString(16).padStart(64, '0')}`
      }

      case 'wallet_revokePermissions':
        this.accounts = []
        return null

      default:
        throw rpcError(4200, `Unsupported method: ${args.method}`)
    }
  }

  on(event: Eip1193Event, listener: (payload: never) => void): void {
    const set = this.#listeners.get(event) ?? new Set()
    set.add(listener)
    this.#listeners.set(event, set)
  }

  removeListener(event: Eip1193Event, listener: (payload: never) => void): void {
    this.#listeners.get(event)?.delete(listener)
  }

  /** How many listeners are attached, for leak assertions. */
  listenerCount(event: Eip1193Event): number {
    return this.#listeners.get(event)?.size ?? 0
  }

  /** Emit a provider event, as a wallet would. */
  emit(event: Eip1193Event, payload: unknown): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      ;(listener as (value: unknown) => void)(payload)
    }
  }

  /** Change chain and notify listeners, as a wallet does on a manual switch. */
  setChain(chainId: number): void {
    this.chainId = chainId
    this.knownChains.add(chainId)
    this.emit('chainChanged', `0x${chainId.toString(16)}`)
  }

  /** Change accounts and notify listeners. An empty array means locked. */
  setAccounts(accounts: string[]): void {
    this.accounts = [...accounts]
    this.emit('accountsChanged', [...accounts])
  }
}

/**
 * Responders registered by {@link announce}, so a test file can tear them down
 * between cases. A wallet extension keeps answering for the lifetime of the
 * page, which is correct in a browser and cross-contaminating in a shared
 * jsdom environment.
 */
const responders: Array<() => void> = []

/** Announce a provider over EIP-6963, exactly as a wallet extension does. */
export function announce(provider: Eip1193Provider, info: { uuid: string; name: string; rdns: string; icon?: string }): void {
  const detail = Object.freeze({
    info: { icon: 'data:image/svg+xml,<svg/>', ...info },
    provider,
  })
  const respond = (): void => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
  }
  window.addEventListener('eip6963:requestProvider', respond)
  responders.push(() => window.removeEventListener('eip6963:requestProvider', respond))
  respond()
}

/** Remove every announced wallet. Call from `afterEach`. */
export function resetAnnouncements(): void {
  while (responders.length > 0) responders.pop()?.()
}

/** Wait for pending microtasks and timers to flush. */
export function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
