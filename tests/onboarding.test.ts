import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hoodMainnet, hoodTestnet } from '../src/core/chains.js'
import { createOnboarding, deriveStatus, stepForStatus, type OnboardingStatus } from '../src/core/onboarding.js'
import { FakeProvider, announce, resetAnnouncements, rpcError, tick } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT = '0x2222222222222222222222222222222222222222'
/** Long enough for the provisional-detection window in `start()` to close. */
const DETECTION_MS = 25

function funded(): Record<string, bigint> {
  return { [ACCOUNT.toLowerCase()]: 10_000_000_000_000_000n }
}

const instances: Array<{ destroy(): void }> = []

/** Every instance shares a short detection window so the suite stays fast. */
function makeOnboarding(config: Parameters<typeof createOnboarding>[0] = {}): ReturnType<typeof createOnboarding> {
  const onboarding = createOnboarding({ detectionTimeoutMs: 5, ...config })
  instances.push(onboarding)
  return onboarding
}

/** A wallet on Ethereum mainnet that has never seen Robinhood Chain. */
function newVisitorWallet(overrides: ConstructorParameters<typeof FakeProvider>[0] = {}): FakeProvider {
  return new FakeProvider({
    grantAccounts: [ACCOUNT],
    chainId: 1,
    knownChains: [1],
    nativeBalances: funded(),
    tokenBalances: { [ACCOUNT.toLowerCase()]: 5_000_000n },
    ...overrides,
  })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  while (instances.length > 0) instances.pop()?.destroy()
  resetAnnouncements()
  window.localStorage.clear()
  delete (window as { ethereum?: unknown }).ethereum
})

describe('deriveStatus', () => {
  const target = { chainId: hoodMainnet.id, requireFunding: true, minNativeWei: 0n }
  const base = {
    started: true,
    providers: [{ info: { uuid: 'a', name: 'A', icon: '', rdns: 'com.a' }, provider: new FakeProvider() }],
    address: ACCOUNT as `0x${string}` | null,
    chainId: hoodMainnet.id as number | null,
    balances: { native: 1n, usdg: 0n } as { native: bigint; usdg: bigint } | null,
    locked: false,
    error: null,
    pending: null as never,
    detectionSettled: true,
  }

  it.each([
    ['detect', 'detecting'],
    ['connect', 'connecting'],
    ['add-chain', 'adding-chain'],
    ['switch-chain', 'switching-chain'],
    ['balance', 'checking-balance'],
  ])('reports the in-flight action %s as %s', (pending, expected) => {
    expect(deriveStatus({ ...base, pending: pending as never }, target)).toBe(expected)
  })

  it('reports idle before start', () => {
    expect(deriveStatus({ ...base, started: false }, target)).toBe('idle')
  })

  it('stays detecting while no wallet has answered yet', () => {
    expect(deriveStatus({ ...base, providers: [], detectionSettled: false }, target)).toBe('detecting')
  })

  it('reports no-wallet only once detection has settled', () => {
    expect(deriveStatus({ ...base, providers: [], detectionSettled: true }, target)).toBe('no-wallet')
  })

  it('reports disconnected, wrong-chain, unfunded, and ready in order', () => {
    expect(deriveStatus({ ...base, address: null }, target)).toBe('disconnected')
    expect(deriveStatus({ ...base, chainId: 1 }, target)).toBe('wrong-chain')
    expect(deriveStatus({ ...base, balances: { native: 0n, usdg: 0n } }, target)).toBe('unfunded')
    expect(deriveStatus(base, target)).toBe('ready')
  })

  it('waits on a balance it has not read yet', () => {
    expect(deriveStatus({ ...base, balances: null }, target)).toBe('checking-balance')
  })

  it('skips the funding step entirely when requireFunding is off', () => {
    expect(deriveStatus({ ...base, balances: null }, { ...target, requireFunding: false })).toBe('ready')
    expect(deriveStatus({ ...base, balances: { native: 0n, usdg: 0n } }, { ...target, requireFunding: false })).toBe('ready')
  })

  it('honours a non-zero funding threshold', () => {
    const threshold = { ...target, minNativeWei: 1_000n }
    expect(deriveStatus({ ...base, balances: { native: 999n, usdg: 0n } }, threshold)).toBe('unfunded')
    expect(deriveStatus({ ...base, balances: { native: 1_001n, usdg: 0n } }, threshold)).toBe('ready')
  })

  it('ranks locked above a recorded error, and both above position', () => {
    expect(deriveStatus({ ...base, locked: true }, target)).toBe('locked')
    expect(deriveStatus({ ...base, error: new Error('x') as never }, target)).toBe('error')
  })
})

describe('stepForStatus', () => {
  const statuses: OnboardingStatus[] = [
    'idle',
    'detecting',
    'no-wallet',
    'disconnected',
    'connecting',
    'locked',
    'wrong-chain',
    'adding-chain',
    'switching-chain',
    'checking-balance',
    'unfunded',
    'ready',
    'error',
  ]

  it('maps every status in the union to a step', () => {
    for (const status of statuses) {
      expect(['connect', 'network', 'fund', 'done']).toContain(stepForStatus(status))
    }
  })
})

describe('createOnboarding lifecycle', () => {
  it('is idle before start and touches nothing', () => {
    const onboarding = makeOnboarding()
    expect(onboarding.getState().status).toBe('idle')
    expect(onboarding.getState().providers).toHaveLength(0)
    expect(onboarding.getState().chain).toBe(hoodMainnet)
  })

  it('exposes a reference-stable server state for useSyncExternalStore', () => {
    const onboarding = makeOnboarding()
    expect(onboarding.getServerState()).toBe(onboarding.getServerState())
    expect(onboarding.getServerState().status).toBe('idle')
  })

  it('lands on no-wallet when nothing announces', async () => {
    const onboarding = makeOnboarding()
    onboarding.start()
    expect(onboarding.getState().status).toBe('detecting')
    await tick(DETECTION_MS)
    expect(onboarding.getState().status).toBe('no-wallet')
  })

  it('lands on disconnected when a wallet announces with no authorised account', async () => {
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    expect(onboarding.getState().status).toBe('disconnected')
    expect(onboarding.getState().providers).toHaveLength(1)
  })

  it('picks up a wallet that announces after start', async () => {
    const onboarding = makeOnboarding()
    onboarding.start()
    expect(onboarding.getState().providers).toHaveLength(0)
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'late', name: 'Late', rdns: 'com.late' })
    await tick(DETECTION_MS)
    expect(onboarding.getState().status).toBe('disconnected')
  })

  it('runs the whole happy path: connect, switch, fund, ready', async () => {
    const wallet = newVisitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    const seen: OnboardingStatus[] = []
    onboarding.subscribe((state) => seen.push(state.status))
    onboarding.start()
    await tick(DETECTION_MS)

    await onboarding.connect()
    expect(onboarding.getState().address).toBe(ACCOUNT)
    expect(onboarding.getState().status).toBe('wrong-chain')

    await onboarding.switchNetwork()
    await tick()

    const state = onboarding.getState()
    expect(state.status).toBe('ready')
    expect(state.chainId).toBe(hoodMainnet.id)
    expect(state.isFunded).toBe(true)
    expect(state.balances?.usdg).toBe(5_000_000n)
    expect(wallet.countOf('wallet_addEthereumChain')).toBe(1)
    expect(seen).toContain('connecting')
    expect(seen).toContain('switching-chain')
  })

  it('stops at unfunded when the account has no gas, then advances when funds land', async () => {
    const wallet = newVisitorWallet({ nativeBalances: {} })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding({ balanceRefreshIntervalMs: 0 })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick()

    expect(onboarding.getState().status).toBe('unfunded')
    expect(onboarding.getState().isFunded).toBe(false)

    wallet.nativeBalances = funded()
    await onboarding.refreshBalances()
    expect(onboarding.getState().status).toBe('ready')
  })

  it('polls the balance while unfunded so a bridge deposit advances the UI on its own', async () => {
    const wallet = newVisitorWallet({ nativeBalances: {} })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding({ balanceRefreshIntervalMs: 20 })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick()
    expect(onboarding.getState().status).toBe('unfunded')

    wallet.nativeBalances = funded()
    await tick(80)
    expect(onboarding.getState().status).toBe('ready')
  })

  it('skips the funding step when requireFunding is false', async () => {
    const wallet = newVisitorWallet({ nativeBalances: {} })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding({ requireFunding: false })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    expect(onboarding.getState().status).toBe('ready')
    expect(wallet.countOf('eth_getBalance')).toBe(0)
  })

  it('switches straight after connecting when autoSwitchChain is on', async () => {
    announce(newVisitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding({ autoSwitchChain: true })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await tick()
    expect(onboarding.getState().status).toBe('ready')
  })

  it('targets the testnet when configured to', async () => {
    const wallet = newVisitorWallet()
    wallet.nativeBalances = funded()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding({ chain: 'testnet' })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick()
    expect(onboarding.getState().chainId).toBe(hoodTestnet.id)
    expect(onboarding.getState().status).toBe('ready')
  })
})

describe('rejection and error paths', () => {
  it('records a rejected connect as an error on the connect step and recovers on retry', async () => {
    const wallet = newVisitorWallet({ accounts: [] })
    wallet.failNext('eth_requestAccounts', rpcError(4001, 'User rejected the request.'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)

    const state = await onboarding.connect()
    expect(state.status).toBe('error')
    expect(state.step).toBe('connect')
    expect(state.error?.code).toBe('user-rejected')
    expect(state.error?.retryable).toBe(true)

    const retried = await onboarding.retry()
    expect(retried.status).toBe('wrong-chain')
    expect(retried.error).toBeNull()
  })

  it('never rejects, so a click handler cannot produce an unhandled rejection', async () => {
    const wallet = newVisitorWallet({ accounts: [] })
    wallet.failAlways('eth_requestAccounts', rpcError(4001, 'User rejected'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await expect(onboarding.connect()).resolves.toMatchObject({ status: 'error' })
  })

  it('reports a locked wallet as its own state, not a generic error', async () => {
    announce(newVisitorWallet({ accounts: [], grantAccounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)

    const state = await onboarding.connect()
    expect(state.status).toBe('locked')
    expect(state.error).toBeNull()
    expect(state.step).toBe('connect')
  })

  it('surfaces -32002 when a prompt is already open', async () => {
    const wallet = newVisitorWallet({ accounts: [] })
    wallet.failNext('eth_requestAccounts', rpcError(-32002, 'Already processing eth_requestAccounts.'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    expect((await onboarding.connect()).error?.code).toBe('request-pending')
  })

  it('records a rejected chain add on the network step', async () => {
    const wallet = newVisitorWallet()
    wallet.failNext('wallet_addEthereumChain', rpcError(4001, 'User rejected the add'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()

    const state = await onboarding.switchNetwork()
    expect(state.status).toBe('error')
    expect(state.step).toBe('network')
    expect(state.error?.code).toBe('user-rejected')

    const retried = await onboarding.retry()
    await tick()
    expect(retried.status).not.toBe('error')
    expect(onboarding.getState().chainId).toBe(hoodMainnet.id)
  })

  it('records a wallet with no add support as unsupported-method and offers no retry', async () => {
    const wallet = newVisitorWallet({ supportsAddChain: false })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()

    const state = await onboarding.switchNetwork()
    expect(state.error?.code).toBe('unsupported-method')
    expect(state.error?.retryable).toBe(false)
  })

  it('records a failed balance read on the fund step instead of reporting a false zero', async () => {
    const wallet = newVisitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    wallet.failAlways('eth_getBalance', new Error('rpc down'))
    await onboarding.switchNetwork()
    await tick()

    const state = onboarding.getState()
    expect(state.status).toBe('error')
    expect(state.step).toBe('fund')
    expect(state.error?.code).toBe('balance-read-failed')
    expect(state.isFunded).toBe(false)
  })

  it('reports no-provider when asked to connect with nothing installed', async () => {
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    const state = await onboarding.connect()
    expect(state.error?.code).toBe('no-provider')
    expect(state.error?.retryable).toBe(false)
  })

  it('asks the caller to choose when several wallets are installed', async () => {
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'u2', name: 'Rabby', rdns: 'io.rabby' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)

    const ambiguous = await onboarding.connect()
    expect(ambiguous.error?.code).toBe('no-provider')
    expect(ambiguous.error?.message).toMatch(/More than one wallet/)

    const chosen = await onboarding.connect('io.rabby')
    expect(chosen.provider?.info.name).toBe('Rabby')
  })

  it('clears an error without retrying', async () => {
    const wallet = newVisitorWallet({ accounts: [] })
    wallet.failNext('eth_requestAccounts', rpcError(4001, 'User rejected'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    expect(onboarding.getState().status).toBe('error')
    onboarding.clearError()
    expect(onboarding.getState().status).toBe('disconnected')
  })
})

describe('wallet events', () => {
  it('follows a manual network switch made inside the wallet', async () => {
    const wallet = newVisitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick()
    expect(onboarding.getState().status).toBe('ready')

    wallet.setChain(1)
    await tick()
    expect(onboarding.getState().status).toBe('wrong-chain')

    wallet.setChain(hoodMainnet.id)
    await tick()
    expect(onboarding.getState().status).toBe('ready')
  })

  it('follows an account switch made inside the wallet', async () => {
    const wallet = newVisitorWallet()
    wallet.nativeBalances[OTHER_ACCOUNT.toLowerCase()] = 5n
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick()

    wallet.setAccounts([OTHER_ACCOUNT])
    await tick(10)
    expect(onboarding.getState().address).toBe(OTHER_ACCOUNT)
    expect(onboarding.getState().status).toBe('ready')
  })

  it('treats an empty accountsChanged as a lock, not as still connected', async () => {
    const wallet = newVisitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick()

    wallet.setAccounts([])
    await tick()
    expect(onboarding.getState().status).toBe('locked')
    expect(onboarding.getState().address).toBeNull()
  })

  it('records a provider disconnect event', async () => {
    const wallet = newVisitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()

    wallet.emit('disconnect', rpcError(4900, 'Disconnected from all chains'))
    await tick()
    expect(onboarding.getState().status).toBe('error')
    expect(onboarding.getState().error?.code).toBe('wallet-disconnected')
  })
})

describe('session persistence and teardown', () => {
  it('restores a previously authorised session with no prompt', async () => {
    const wallet = newVisitorWallet({ accounts: [ACCOUNT], chainId: hoodMainnet.id, knownChains: [hoodMainnet.id] })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    window.localStorage.setItem('hood-connect.wallet', 'io.metamask')

    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)

    expect(onboarding.getState().address).toBe(ACCOUNT)
    expect(onboarding.getState().status).toBe('ready')
    expect(wallet.countOf('eth_requestAccounts')).toBe(0)
  })

  it('does not restore when autoConnect is off', async () => {
    announce(newVisitorWallet({ accounts: [ACCOUNT] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding({ autoConnect: false })
    onboarding.start()
    await tick(DETECTION_MS)
    expect(onboarding.getState().address).toBeNull()
    expect(onboarding.getState().status).toBe('disconnected')
  })

  it('remembers the wallet after a manual connect and forgets it on disconnect', async () => {
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    expect(window.localStorage.getItem('hood-connect.wallet')).toBe('io.metamask')

    await onboarding.disconnect()
    expect(window.localStorage.getItem('hood-connect.wallet')).toBeNull()
    expect(onboarding.getState().status).toBe('disconnected')
  })

  it('accepts a custom storage and a disabled storage', async () => {
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const store = new Map<string, string>()
    const onboarding = makeOnboarding({
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
      },
    })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    expect(store.get('hood-connect.wallet')).toBe('io.metamask')

    const noStorage = makeOnboarding({ storage: null })
    noStorage.start()
    await tick(DETECTION_MS)
    await noStorage.connect()
    expect(window.localStorage.getItem('hood-connect.wallet')).toBeNull()
  })

  it('revokes wallet permission when asked', async () => {
    const wallet = newVisitorWallet({ accounts: [] })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = makeOnboarding()
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.disconnect({ revoke: true })
    expect(wallet.countOf('wallet_revokePermissions')).toBe(1)
  })

  it('detaches every provider listener on destroy', async () => {
    const wallet = newVisitorWallet({ accounts: [] })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = createOnboarding({ detectionTimeoutMs: 5 })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    expect(wallet.listenerCount('accountsChanged')).toBe(1)
    expect(wallet.listenerCount('chainChanged')).toBe(1)

    onboarding.destroy()
    expect(wallet.listenerCount('accountsChanged')).toBe(0)
    expect(wallet.listenerCount('chainChanged')).toBe(0)
    expect(wallet.listenerCount('disconnect')).toBe(0)
    expect(onboarding.isDestroyed()).toBe(true)
  })

  it('is inert after destroy and safe to destroy twice', async () => {
    const onboarding = createOnboarding({ detectionTimeoutMs: 5 })
    onboarding.start()
    onboarding.destroy()
    onboarding.destroy()
    const listener = vi.fn()
    onboarding.subscribe(listener)
    await onboarding.connect()
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops the balance poll on destroy', async () => {
    const wallet = newVisitorWallet({ nativeBalances: {} })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onboarding = createOnboarding({ detectionTimeoutMs: 5, balanceRefreshIntervalMs: 10 })
    onboarding.start()
    await tick(DETECTION_MS)
    await onboarding.connect()
    await onboarding.switchNetwork()
    await tick(30)

    onboarding.destroy()
    const before = wallet.countOf('eth_getBalance')
    await tick(50)
    expect(wallet.countOf('eth_getBalance')).toBe(before)
  })

  it('always offers at least one funding route', async () => {
    announce(newVisitorWallet({ accounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    for (const chain of ['mainnet', 'testnet'] as const) {
      const onboarding = makeOnboarding({ chain })
      onboarding.start()
      await tick(DETECTION_MS)
      expect(onboarding.getState().fundingRoutes.length).toBeGreaterThan(0)
      expect(onboarding.getState().fundingRoutes.some((route) => route.kind === 'receive')).toBe(true)
    }
  })
})
