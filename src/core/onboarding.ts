import { readBalances, type HoodBalances } from './balances.js'
import { resolveHoodChain, type HoodChainId, type HoodChainInfo, type HoodNetwork } from './chains.js'
import { createProviderStore, type ProviderStore } from './eip6963.js'
import { HoodConnectError, toHoodConnectError } from './errors.js'
import { buildFundingRoutes, type FundingOptions, type FundingRoute } from './funding.js'
import type { Eip6963ProviderDetail } from './provider.js'
import {
  addChain,
  getAccounts,
  getChainId,
  requestAccounts,
  revokePermissions,
  switchChain,
  watchAccounts,
  watchChain,
  watchDisconnect,
  type AccountAddress,
} from './wallet.js'

/**
 * The complete onboarding state machine: discover a wallet, connect it, get it
 * onto Robinhood Chain, and get it funded.
 *
 * The status union below is exhaustive on purpose. A consumer that switches on
 * it with no default branch gets a compile error the moment a state is
 * unhandled, which is the whole point: the states that go unbuilt in
 * hand-rolled onboarding flows are exactly the ones users hit first (no wallet
 * installed, wallet locked, network missing, zero balance).
 */
export type OnboardingStatus =
  /** Created but not started. The only status rendered during SSR. */
  | 'idle'
  /** Listening for EIP-6963 announcements. */
  | 'detecting'
  /** No injected wallet answered. The user needs to install one. */
  | 'no-wallet'
  /** A wallet is available but this site has no authorised account. */
  | 'disconnected'
  /** `eth_requestAccounts` is in flight. A wallet prompt is open. */
  | 'connecting'
  /** The wallet is installed but locked, or every account is revoked. */
  | 'locked'
  /** Connected, but the wallet is pointed at another chain. */
  | 'wrong-chain'
  /** `wallet_addEthereumChain` is in flight. */
  | 'adding-chain'
  /** `wallet_switchEthereumChain` is in flight. */
  | 'switching-chain'
  /** Reading native and USDG balances. */
  | 'checking-balance'
  /** On the right chain with no gas. The user must bridge or receive. */
  | 'unfunded'
  /** Connected, on Robinhood Chain, funded. The dApp can proceed. */
  | 'ready'
  /** The last action failed. `error` explains it and `step` says where. */
  | 'error'

/** Which of the three onboarding steps a status belongs to. */
export type OnboardingStep = 'connect' | 'network' | 'fund' | 'done'

/** The action currently in flight, if any. */
export type PendingAction = 'detect' | 'connect' | 'add-chain' | 'switch-chain' | 'balance' | null

/** A full snapshot of the flow. Immutable: every change produces a new object. */
export interface OnboardingState {
  status: OnboardingStatus
  /** The step to render. On `error`, the step the failure happened in. */
  step: OnboardingStep
  /** Every wallet discovered over EIP-6963, plus a legacy `window.ethereum`. */
  providers: readonly Eip6963ProviderDetail[]
  /** The wallet the user picked, once one is selected. */
  provider: Eip6963ProviderDetail | null
  /** The connected account, or `null`. */
  address: AccountAddress | null
  /** The chain the wallet reports, or `null` before connecting. */
  chainId: number | null
  /** The Robinhood Chain network this flow targets. */
  chain: HoodChainInfo
  /** Balances once read, else `null`. */
  balances: HoodBalances | null
  /** Whether the native balance clears `minNativeWei`. */
  isFunded: boolean
  /** The last failure, cleared by any action that succeeds. */
  error: HoodConnectError | null
  /** The in-flight action, for spinners and disabled buttons. */
  pending: PendingAction
  /** Funding routes for the current chain and address. */
  fundingRoutes: readonly FundingRoute[]
}

/** Persistence for the "reconnect me automatically" preference. */
export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Configuration for {@link createOnboarding}. */
export interface OnboardingConfig {
  /**
   * Target network.
   * @defaultValue `'mainnet'` (chain 4663)
   */
  chain?: HoodChainId | HoodNetwork
  /**
   * Read balances over this HTTP RPC endpoint instead of through the wallet.
   * Leave unset to read through the connected provider, which is correct by
   * construction and needs no CORS allowance.
   */
  rpcUrl?: string
  /**
   * Include the funding step. Set `false` for a dApp where a zero balance is a
   * valid state (a read-only explorer, a gasless meta-transaction dApp).
   * @defaultValue `true`
   */
  requireFunding?: boolean
  /**
   * Native balance, in wei, that counts as funded. The check is
   * `native > minNativeWei`, so the default treats any non-zero balance as
   * funded.
   * @defaultValue `0n`
   */
  minNativeWei?: bigint
  /**
   * Silently restore the previous session on {@link Onboarding.start} using
   * `eth_accounts`, which never opens a prompt.
   * @defaultValue `true`
   */
  autoConnect?: boolean
  /**
   * Switch to Robinhood Chain immediately after connecting, without waiting
   * for the user to press the network button.
   * @defaultValue `false`
   */
  autoSwitchChain?: boolean
  /** Customise the funding routes shown in step three. */
  funding?: FundingOptions
  /**
   * Where to persist the last wallet choice. Pass `null` to disable
   * persistence entirely.
   * @defaultValue `window.localStorage` when available
   */
  storage?: OnboardingStorage | null
  /** @defaultValue `'hood-connect.wallet'` */
  storageKey?: string
  /**
   * Re-read balances on this interval while the flow sits in `unfunded`, so an
   * incoming bridge deposit advances the UI on its own.
   * Set `0` to disable polling.
   * @defaultValue `12000`
   */
  balanceRefreshIntervalMs?: number
  /**
   * Fold a pre-EIP-6963 `window.ethereum` into the provider list.
   * @defaultValue `true`
   */
  includeLegacyWindowEthereum?: boolean
  /**
   * How long to keep the "no wallet installed" verdict provisional after
   * {@link Onboarding.start}. Extensions inject at different points in page
   * load, so answering immediately would flash an install prompt at someone
   * who already has a wallet.
   * @defaultValue `600`
   */
  detectionTimeoutMs?: number
}

/** The controller returned by {@link createOnboarding}. */
export interface Onboarding {
  /** Current snapshot. Reference-stable until something changes. */
  getState(): OnboardingState
  /** The snapshot to render on a server: always `idle`, never touches window. */
  getServerState(): OnboardingState
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: OnboardingState) => void): () => void
  /** Start discovery and, when `autoConnect` is on, restore the session. */
  start(): void
  /** Re-broadcast the EIP-6963 discovery request. */
  refreshProviders(): void
  /**
   * Connect a wallet, prompting the user.
   *
   * Pass a wallet's EIP-6963 UUID or rdns, or the detail object itself. With
   * no argument it uses the already-selected wallet, or the only discovered
   * one, and reports `no-provider` when the choice is ambiguous.
   */
  connect(target?: string | Eip6963ProviderDetail): Promise<OnboardingState>
  /** Add Robinhood Chain to the wallet without switching to it. */
  addNetwork(): Promise<OnboardingState>
  /** Switch to Robinhood Chain, adding it first if the wallet lacks it. */
  switchNetwork(): Promise<OnboardingState>
  /** Re-read balances now. */
  refreshBalances(): Promise<OnboardingState>
  /** Retry whatever action last failed. */
  retry(): Promise<OnboardingState>
  /** Drop the session locally, and revoke it in the wallet where supported. */
  disconnect(options?: { revoke?: boolean }): Promise<OnboardingState>
  /** Clear the error without retrying. */
  clearError(): void
  /** Remove every listener, interval, and subscription. */
  destroy(): void
  /** True once {@link Onboarding.destroy} has run. The instance is inert. */
  isDestroyed(): boolean
}

interface Context {
  started: boolean
  providers: readonly Eip6963ProviderDetail[]
  provider: Eip6963ProviderDetail | null
  address: AccountAddress | null
  chainId: number | null
  balances: HoodBalances | null
  locked: boolean
  error: HoodConnectError | null
  errorStep: OnboardingStep
  pending: PendingAction
  detectionSettled: boolean
}

/**
 * Map a settled context to its status. Pure, total, and the single place a
 * status is decided, so the machine cannot drift between actions.
 *
 * Order matters: an in-flight action outranks everything, then a locked
 * wallet, then a recorded error, then the position in the flow.
 */
export function deriveStatus(
  context: Pick<Context, 'started' | 'providers' | 'address' | 'chainId' | 'balances' | 'locked' | 'error' | 'pending' | 'detectionSettled'>,
  target: { chainId: HoodChainId; requireFunding: boolean; minNativeWei: bigint },
): OnboardingStatus {
  switch (context.pending) {
    case 'detect':
      return 'detecting'
    case 'connect':
      return 'connecting'
    case 'add-chain':
      return 'adding-chain'
    case 'switch-chain':
      return 'switching-chain'
    case 'balance':
      return 'checking-balance'
    case null:
      break
  }

  if (context.locked) return 'locked'
  if (context.error) return 'error'
  if (!context.started) return 'idle'
  if (context.providers.length === 0) return context.detectionSettled ? 'no-wallet' : 'detecting'
  if (!context.address) return 'disconnected'
  if (context.chainId !== target.chainId) return 'wrong-chain'
  if (!target.requireFunding) return 'ready'
  if (context.balances === null) return 'checking-balance'
  return context.balances.native > target.minNativeWei ? 'ready' : 'unfunded'
}

/** The step a status belongs to. Pure and total. */
export function stepForStatus(status: OnboardingStatus): OnboardingStep {
  switch (status) {
    case 'idle':
    case 'detecting':
    case 'no-wallet':
    case 'disconnected':
    case 'connecting':
    case 'locked':
      return 'connect'
    case 'wrong-chain':
    case 'adding-chain':
    case 'switching-chain':
      return 'network'
    case 'checking-balance':
    case 'unfunded':
      return 'fund'
    case 'ready':
      return 'done'
    case 'error':
      // Resolved by the caller from the recorded failure step.
      return 'connect'
  }
}

/**
 * Create the onboarding controller.
 *
 * Nothing observes the browser until {@link Onboarding.start} is called, so
 * this is safe to construct during a server render.
 *
 * @example
 * ```ts
 * import { createOnboarding } from 'hood-connect'
 *
 * const onboarding = createOnboarding({ chain: 'mainnet' })
 * onboarding.subscribe((state) => {
 *   if (state.status === 'ready') console.log('ready:', state.address)
 * })
 * onboarding.start()
 * await onboarding.connect()
 * await onboarding.switchNetwork()
 * ```
 */
export function createOnboarding(config: OnboardingConfig = {}): Onboarding {
  const chain = resolveHoodChain(config.chain ?? 'mainnet')
  const requireFunding = config.requireFunding ?? true
  const minNativeWei = config.minNativeWei ?? 0n
  const autoConnect = config.autoConnect ?? true
  const autoSwitchChain = config.autoSwitchChain ?? false
  const storageKey = config.storageKey ?? 'hood-connect.wallet'
  const refreshIntervalMs = config.balanceRefreshIntervalMs ?? 12_000
  const fundingOptions = config.funding ?? {}
  const detectionTimeoutMs = config.detectionTimeoutMs ?? 600

  const store: ProviderStore = createProviderStore(
    config.includeLegacyWindowEthereum === undefined
      ? {}
      : { includeLegacyWindowEthereum: config.includeLegacyWindowEthereum },
  )

  const listeners = new Set<(state: OnboardingState) => void>()
  const providerCleanups: Array<() => void> = []

  let context: Context = {
    started: false,
    providers: store.getServerSnapshot(),
    provider: null,
    address: null,
    chainId: null,
    balances: null,
    locked: false,
    error: null,
    errorStep: 'connect',
    pending: null,
    detectionSettled: false,
  }

  let state: OnboardingState = buildState(context)
  let destroyed = false
  let unsubscribeStore: (() => void) | null = null
  let detectionTimer: ReturnType<typeof setTimeout> | null = null
  let balanceTimer: ReturnType<typeof setInterval> | null = null
  /** Guards against a stale balance read overwriting a newer one. */
  let balanceRun = 0

  function resolveStorage(): OnboardingStorage | null {
    if (config.storage !== undefined) return config.storage
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage
    } catch {
      // Blocked by a privacy setting. Persistence is optional, so degrade.
      return null
    }
  }

  function rememberWallet(detail: Eip6963ProviderDetail | null): void {
    const storage = resolveStorage()
    if (!storage) return
    try {
      if (detail) storage.setItem(storageKey, detail.info.rdns)
      else storage.removeItem(storageKey)
    } catch {
      // Storage quota or a private-mode write failure never breaks the flow.
    }
  }

  function buildState(next: Context): OnboardingState {
    const status = deriveStatus(next, { chainId: chain.id, requireFunding, minNativeWei })
    const step = status === 'error' ? next.errorStep : stepForStatus(status)
    return {
      status,
      step,
      providers: next.providers,
      provider: next.provider,
      address: next.address,
      chainId: next.chainId,
      chain,
      balances: next.balances,
      isFunded: next.balances !== null && next.balances.native > minNativeWei,
      error: next.error,
      pending: next.pending,
      fundingRoutes: Object.freeze(buildFundingRoutes(chain, next.address, fundingOptions)),
    }
  }

  function commit(patch: Partial<Context>): OnboardingState {
    if (destroyed) return state
    const next = { ...context, ...patch }

    // Balances belong to one account on one chain. Invalidating them here, in
    // the single place state changes, is what keeps a stale read from
    // surviving a switch, and equally what stops a fresh read being thrown
    // away by a later action that merely restates the same chain. Doing it
    // imperatively at each call site produced a visible ready-to-checking
    // flicker when a `chainChanged` event and an explicit switch raced.
    if (patch.balances === undefined && (next.chainId !== context.chainId || next.address !== context.address)) {
      next.balances = null
    }

    context = next
    state = buildState(context)
    for (const listener of [...listeners]) listener(state)
    syncBalancePolling()
    return state
  }

  function fail(step: OnboardingStep, error: unknown): OnboardingState {
    const normalised = toHoodConnectError(error)
    if (normalised.code === 'wallet-locked') {
      return commit({ pending: null, locked: true, error: null, address: null })
    }
    return commit({ pending: null, error: normalised, errorStep: step })
  }

  function detachProvider(): void {
    while (providerCleanups.length > 0) {
      const cleanup = providerCleanups.pop()
      if (cleanup) cleanup()
    }
  }

  function attachProvider(detail: Eip6963ProviderDetail): void {
    detachProvider()
    const { provider } = detail

    providerCleanups.push(
      watchAccounts(provider, (accounts) => {
        const next = accounts[0] ?? null
        if (next === null) {
          // An empty accountsChanged means locked or revoked, never "still connected".
          commit({ address: null, balances: null, locked: true })
          return
        }
        if (next !== context.address) commit({ address: next, locked: false })
        void syncBalances()
      }),
    )

    providerCleanups.push(
      watchChain(provider, (chainId) => {
        commit({ chainId, error: null })
        void syncBalances()
      }),
    )

    providerCleanups.push(
      watchDisconnect(provider, (error) => {
        commit({ address: null, chainId: null, balances: null, error, errorStep: 'connect' })
      }),
    )
  }

  async function syncBalances(): Promise<OnboardingState> {
    if (destroyed) return state
    if (!requireFunding || !context.address || context.chainId !== chain.id) return state

    const run = ++balanceRun
    const address = context.address
    const source = config.rpcUrl
      ? { rpcUrl: config.rpcUrl }
      : context.provider
        ? { provider: context.provider.provider }
        : null
    if (!source) return state

    const showSpinner = context.balances === null
    if (showSpinner) commit({ pending: 'balance' })

    try {
      const balances = await readBalances(source, chain, address)
      if (destroyed || run !== balanceRun) return state
      return commit({ balances, pending: null, error: null })
    } catch (error) {
      if (destroyed || run !== balanceRun) return state
      return fail('fund', error)
    }
  }

  function syncBalancePolling(): void {
    const shouldPoll = refreshIntervalMs > 0 && state.status === 'unfunded'
    if (shouldPoll && balanceTimer === null) {
      balanceTimer = setInterval(() => {
        void syncBalances()
      }, refreshIntervalMs)
    } else if (!shouldPoll && balanceTimer !== null) {
      clearInterval(balanceTimer)
      balanceTimer = null
    }
  }

  function pickProvider(target?: string | Eip6963ProviderDetail): Eip6963ProviderDetail | null {
    if (target && typeof target === 'object') return target
    if (typeof target === 'string') {
      return store.getByUuid(target) ?? store.getByRdns(target) ?? null
    }
    if (context.provider) return context.provider
    const providers = context.providers
    return providers.length === 1 ? (providers[0] ?? null) : null
  }

  async function adoptSession(detail: Eip6963ProviderDetail, address: AccountAddress): Promise<OnboardingState> {
    attachProvider(detail)
    rememberWallet(detail)
    const chainId = await getChainId(detail.provider).catch(() => null)
    const next = commit({
      provider: detail,
      address,
      chainId,
      locked: false,
      error: null,
      pending: null,
    })
    if (chainId !== chain.id && autoSwitchChain) return switchNetwork()
    void syncBalances()
    return next
  }

  async function restoreSession(): Promise<void> {
    if (!autoConnect || destroyed) return
    const storage = resolveStorage()
    let remembered: string | null = null
    try {
      remembered = storage?.getItem(storageKey) ?? null
    } catch {
      remembered = null
    }

    const candidates = remembered
      ? [store.getByRdns(remembered)].filter((detail): detail is Eip6963ProviderDetail => detail !== undefined)
      : [...context.providers]

    for (const detail of candidates) {
      if (destroyed) return
      const accounts = await getAccounts(detail.provider).catch(() => [])
      const address = accounts[0]
      if (address) {
        await adoptSession(detail, address)
        return
      }
    }
  }

  function onProvidersChanged(): void {
    const providers = store.getSnapshot()
    if (providers === context.providers) return
    commit({ providers, ...(providers.length > 0 ? { detectionSettled: true } : {}) })
    if (context.provider === null && autoConnect) void restoreSession()
  }

  async function connect(target?: string | Eip6963ProviderDetail): Promise<OnboardingState> {
    if (destroyed) return state
    if (context.pending !== null) return state

    const detail = pickProvider(target)
    if (!detail) {
      return fail(
        'connect',
        new HoodConnectError(
          'no-provider',
          context.providers.length === 0
            ? 'No wallet was found on this page.'
            : 'More than one wallet is installed. Pass the wallet to connect, for example connect(providers[0]).',
        ),
      )
    }

    commit({ pending: 'connect', error: null, locked: false, provider: detail })
    try {
      const accounts = await requestAccounts(detail.provider)
      const address = accounts[0]
      if (!address) {
        throw new HoodConnectError('wallet-locked', 'The wallet authorised no accounts for this site.')
      }
      return await adoptSession(detail, address)
    } catch (error) {
      return fail('connect', error)
    }
  }

  async function addNetwork(): Promise<OnboardingState> {
    if (destroyed) return state
    const detail = context.provider
    if (!detail) return fail('network', new HoodConnectError('no-provider', 'Connect a wallet before adding the network.'))

    commit({ pending: 'add-chain', error: null })
    try {
      await addChain(detail.provider, chain)
      const chainId = await getChainId(detail.provider).catch(() => context.chainId)
      const next = commit({ pending: null, chainId, error: null })
      void syncBalances()
      return next
    } catch (error) {
      return fail('network', error)
    }
  }

  async function switchNetwork(): Promise<OnboardingState> {
    if (destroyed) return state
    const detail = context.provider
    if (!detail) return fail('network', new HoodConnectError('no-provider', 'Connect a wallet before switching networks.'))

    commit({ pending: 'switch-chain', error: null })
    try {
      await switchChain(detail.provider, chain)
      const chainId = await getChainId(detail.provider).catch(() => chain.id)
      const next = commit({ pending: null, chainId, error: null })
      void syncBalances()
      return next
    } catch (error) {
      return fail('network', error)
    }
  }

  async function disconnect(options: { revoke?: boolean } = {}): Promise<OnboardingState> {
    const detail = context.provider
    if (detail && options.revoke) await revokePermissions(detail.provider)
    detachProvider()
    rememberWallet(null)
    balanceRun += 1
    return commit({
      provider: null,
      address: null,
      chainId: null,
      balances: null,
      locked: false,
      error: null,
      pending: null,
    })
  }

  async function retry(): Promise<OnboardingState> {
    const step = context.error ? context.errorStep : state.step
    commit({ error: null, locked: false })
    switch (step) {
      case 'connect':
        return connect()
      case 'network':
        return switchNetwork()
      case 'fund':
        return syncBalances()
      case 'done':
        return state
    }
  }

  // Cached, because `useSyncExternalStore` compares server snapshots by
  // reference and a fresh object on every call is an infinite render loop.
  const serverState: OnboardingState = buildState({ ...context, started: false, pending: null })

  return {
    getState: () => state,
    getServerState: () => serverState,
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start(): void {
      if (context.started || destroyed) return
      commit({ started: true, pending: typeof window === 'undefined' ? null : 'detect' })
      if (typeof window === 'undefined') {
        commit({ pending: null, detectionSettled: true })
        return
      }
      unsubscribeStore = store.subscribe(onProvidersChanged)
      store.start()
      const providers = store.getSnapshot()
      commit({ providers, pending: null, detectionSettled: providers.length > 0 })
      if (providers.length > 0) void restoreSession()

      // Wallets that inject late still announce, so keep the "no wallet" verdict
      // provisional for a moment rather than flashing an install prompt at
      // someone who has a wallet.
      detectionTimer = setTimeout(() => {
        detectionTimer = null
        store.refresh()
        commit({ detectionSettled: true })
        if (context.provider === null) void restoreSession()
      }, detectionTimeoutMs)
    },
    refreshProviders(): void {
      store.refresh()
      onProvidersChanged()
    },
    connect,
    addNetwork,
    switchNetwork,
    refreshBalances: () => syncBalances(),
    retry,
    disconnect,
    clearError(): void {
      if (context.error !== null || context.locked) commit({ error: null, locked: false })
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      if (detectionTimer !== null) clearTimeout(detectionTimer)
      if (balanceTimer !== null) clearInterval(balanceTimer)
      detectionTimer = null
      balanceTimer = null
      detachProvider()
      if (unsubscribeStore) unsubscribeStore()
      unsubscribeStore = null
      store.destroy()
      listeners.clear()
    },
    isDestroyed: () => destroyed,
  }
}
