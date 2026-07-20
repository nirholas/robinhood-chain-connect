import { parseChainId, type HoodChainInfo } from './chains.js'
import { HoodConnectError, toHoodConnectError } from './errors.js'
import type { Eip1193Event, Eip1193Provider } from './provider.js'

/**
 * Thin, typed wrappers over the wallet RPC methods the onboarding flow needs.
 *
 * Each one normalises failures into a {@link HoodConnectError} so callers never
 * have to know a wallet's numeric codes.
 */

/** A checksummed or lowercase hex account address. */
export type AccountAddress = `0x${string}`

function normaliseAccounts(result: unknown): AccountAddress[] {
  if (!Array.isArray(result)) return []
  return result.filter((value): value is AccountAddress => typeof value === 'string' && value.startsWith('0x'))
}

/**
 * Accounts already authorised for this origin. Never opens a prompt, so it is
 * the correct call for silent session restore on page load.
 */
export async function getAccounts(provider: Eip1193Provider): Promise<AccountAddress[]> {
  try {
    return normaliseAccounts(await provider.request({ method: 'eth_accounts' }))
  } catch (error) {
    throw toHoodConnectError(error)
  }
}

/**
 * Prompt the user to connect. Resolves to the authorised accounts.
 *
 * @throws {@link HoodConnectError} with code `user-rejected` (4001),
 * `request-pending` (-32002), or `wallet-locked` when the wallet returns an
 * empty account list.
 */
export async function requestAccounts(provider: Eip1193Provider): Promise<AccountAddress[]> {
  let accounts: AccountAddress[]
  try {
    accounts = normaliseAccounts(await provider.request({ method: 'eth_requestAccounts' }))
  } catch (error) {
    throw toHoodConnectError(error)
  }
  if (accounts.length === 0) {
    throw new HoodConnectError(
      'wallet-locked',
      'The wallet returned no accounts. It is locked, or every account is revoked for this site.',
    )
  }
  return accounts
}

/** Read the chain the wallet is currently pointed at. */
export async function getChainId(provider: Eip1193Provider): Promise<number> {
  let raw: unknown
  try {
    raw = await provider.request({ method: 'eth_chainId' })
  } catch (error) {
    throw toHoodConnectError(error)
  }
  const chainId = parseChainId(raw)
  if (chainId === null) {
    throw new HoodConnectError('unknown', `The wallet returned an unreadable chain ID: ${JSON.stringify(raw)}`)
  }
  return chainId
}

/**
 * Ask the wallet to add a network with {@link HoodChainInfo.addChainParameter}.
 *
 * A wallet that already knows the chain treats this as a no-op and resolves.
 */
export async function addChain(provider: Eip1193Provider, chain: HoodChainInfo): Promise<void> {
  try {
    await provider.request({ method: 'wallet_addEthereumChain', params: [chain.addChainParameter] })
  } catch (error) {
    const normalised = toHoodConnectError(error, 'chain-add-failed')
    // A rejected add is a user decision, not a wallet defect: keep 4001 intact.
    if (normalised.code === 'unknown') {
      throw new HoodConnectError('chain-add-failed', normalised.message, { cause: error })
    }
    throw normalised
  }
}

/**
 * Point the wallet at a Robinhood Chain network, adding it first when needed.
 *
 * `wallet_switchEthereumChain` fails with 4902 when the wallet has never heard
 * of the chain, which is the normal case for a first-time visitor. That is not
 * an error to surface: it is the signal to call `wallet_addEthereumChain` and
 * try the switch again. Wallets that add-and-select in one step resolve after
 * the add, so the second switch is tolerated as a no-op.
 *
 * @example
 * ```ts
 * import { switchChain, hoodMainnet } from 'hood-connect'
 *
 * await switchChain(provider, hoodMainnet)
 * ```
 */
export async function switchChain(provider: Eip1193Provider, chain: HoodChainInfo): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.hexChainId }],
    })
    return
  } catch (error) {
    const normalised = toHoodConnectError(error)
    if (normalised.code !== 'chain-not-added') throw normalised

    await addChain(provider, chain)

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chain.hexChainId }],
      })
    } catch (secondError) {
      const secondNormalised = toHoodConnectError(secondError)
      // The add already selected the chain in some wallets, which then reject
      // the redundant switch. Trust the chain the wallet reports over the code.
      if (secondNormalised.code === 'chain-not-added') throw secondNormalised
      const current = await getChainId(provider).catch(() => null)
      if (current === chain.id) return
      throw secondNormalised
    }
  }
}

function addListener(provider: Eip1193Provider, event: Eip1193Event, listener: (payload: never) => void): () => void {
  if (typeof provider.on !== 'function') return () => undefined
  provider.on(event, listener)
  return () => {
    if (typeof provider.removeListener === 'function') provider.removeListener(event, listener)
    else if (typeof provider.off === 'function') provider.off(event, listener)
  }
}

/**
 * Subscribe to `accountsChanged`. An empty array means the wallet locked or the
 * user revoked this site, which callers must treat as a disconnect.
 *
 * @returns an unsubscribe function. Always call it on unmount: providers hold
 * listeners for the lifetime of the page and leak otherwise.
 */
export function watchAccounts(provider: Eip1193Provider, onChange: (accounts: AccountAddress[]) => void): () => void {
  return addListener(provider, 'accountsChanged', ((accounts: unknown) => {
    onChange(normaliseAccounts(accounts))
  }) as (payload: never) => void)
}

/** Subscribe to `chainChanged`. Returns an unsubscribe function. */
export function watchChain(provider: Eip1193Provider, onChange: (chainId: number) => void): () => void {
  return addListener(provider, 'chainChanged', ((raw: unknown) => {
    const chainId = parseChainId(raw)
    if (chainId !== null) onChange(chainId)
  }) as (payload: never) => void)
}

/** Subscribe to `disconnect`. Returns an unsubscribe function. */
export function watchDisconnect(provider: Eip1193Provider, onDisconnect: (error: HoodConnectError) => void): () => void {
  return addListener(provider, 'disconnect', ((raw: unknown) => {
    onDisconnect(toHoodConnectError(raw, 'wallet-disconnected'))
  }) as (payload: never) => void)
}

/**
 * Revoke this site's account permission where the wallet supports it.
 *
 * `wallet_revokePermissions` is a MetaMask extension, not a standard. Wallets
 * without it are disconnected locally by dropping the session, which is why
 * this resolves rather than throwing on an unsupported method.
 *
 * @returns `true` when the wallet actually revoked the permission.
 */
export async function revokePermissions(provider: Eip1193Provider): Promise<boolean> {
  try {
    await provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
    return true
  } catch {
    return false
  }
}
