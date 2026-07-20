import { describe, expect, it } from 'vitest'
import { hoodMainnet } from '../src/core/chains.js'
import { HoodConnectError } from '../src/core/errors.js'
import type { OnboardingState, OnboardingStatus } from '../src/core/onboarding.js'
import { buildFundingRoutes } from '../src/core/funding.js'
import { buildView } from '../src/ui/view.js'
import { FakeProvider } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'

const WALLET = {
  info: { uuid: 'u1', name: 'MetaMask', icon: 'data:image/svg+xml,<svg/>', rdns: 'io.metamask' },
  provider: new FakeProvider(),
}

/** Every status in the union. Kept literal so a new state fails this file. */
const ALL_STATUSES: OnboardingStatus[] = [
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

function stateFor(status: OnboardingStatus, overrides: Partial<OnboardingState> = {}): OnboardingState {
  const connected = !['idle', 'detecting', 'no-wallet', 'disconnected', 'connecting', 'locked'].includes(status)
  const address = connected ? (ACCOUNT as `0x${string}`) : null
  return {
    status,
    step:
      status === 'wrong-chain' || status === 'adding-chain' || status === 'switching-chain'
        ? 'network'
        : status === 'checking-balance' || status === 'unfunded'
          ? 'fund'
          : status === 'ready'
            ? 'done'
            : 'connect',
    providers: status === 'no-wallet' || status === 'idle' || status === 'detecting' ? [] : [WALLET],
    provider: connected || status === 'connecting' || status === 'locked' ? WALLET : null,
    address,
    chainId: status === 'wrong-chain' ? 1 : connected ? hoodMainnet.id : null,
    chain: hoodMainnet,
    balances: status === 'unfunded' ? { native: 0n, usdg: 0n } : status === 'ready' ? { native: 10n ** 18n, usdg: 5_000_000n } : null,
    isFunded: status === 'ready',
    error: null,
    pending: null,
    fundingRoutes: buildFundingRoutes(hoodMainnet, address),
    ...overrides,
  }
}

describe('buildView', () => {
  it('designs every status: a title, a next step, and never a blank box', () => {
    for (const status of ALL_STATUSES) {
      const view = buildView(stateFor(status))
      expect(view.title, status).not.toBe('')
      expect(view.detail.length, status).toBeGreaterThan(20)
      expect(['neutral', 'busy', 'error', 'success']).toContain(view.tone)
      // Every state either offers an action or is genuinely in flight.
      const hasSomethingToDo = view.actions.length > 0 || view.walletChoices.length > 0 || view.routes.length > 0
      expect(hasSomethingToDo || view.busy, `${status} has neither an action nor a spinner`).toBe(true)
    }
  })

  it('marks the in-flight states busy and the settled ones not', () => {
    for (const status of ['idle', 'detecting', 'connecting', 'adding-chain', 'switching-chain', 'checking-balance'] as const) {
      expect(buildView(stateFor(status)).busy, status).toBe(true)
    }
    for (const status of ['no-wallet', 'disconnected', 'locked', 'wrong-chain', 'unfunded', 'ready'] as const) {
      expect(buildView(stateFor(status)).busy, status).toBe(false)
    }
  })

  it('walks the step index forward through the flow', () => {
    expect(buildView(stateFor('disconnected')).stepIndex).toBe(1)
    expect(buildView(stateFor('wrong-chain')).stepIndex).toBe(2)
    expect(buildView(stateFor('unfunded')).stepIndex).toBe(3)
    expect(buildView(stateFor('ready')).stepIndex).toBe(3)
  })

  it('offers an install link and a rescan when no wallet is present', () => {
    const view = buildView(stateFor('no-wallet'))
    const ids = view.actions.map((action) => action.id)
    expect(ids).toContain('install')
    expect(ids).toContain('refresh-providers')
    expect(view.actions.find((action) => action.id === 'install')?.href).toContain('https://')
  })

  it('offers a single connect button for one wallet and a picker for several', () => {
    const single = buildView(stateFor('disconnected'))
    expect(single.actions.map((action) => action.id)).toEqual(['connect'])
    expect(single.walletChoices).toHaveLength(0)

    const many = buildView(
      stateFor('disconnected', {
        providers: [WALLET, { info: { ...WALLET.info, uuid: 'u2', name: 'Rabby', rdns: 'io.rabby' }, provider: new FakeProvider() }],
      }),
    )
    expect(many.actions).toHaveLength(0)
    expect(many.walletChoices.map((choice) => choice.label)).toEqual(['MetaMask', 'Rabby'])
    expect(many.walletChoices[0]?.providerUuid).toBe('u1')
  })

  it('explains the wrong chain with both chain IDs and offers switch plus add', () => {
    const view = buildView(stateFor('wrong-chain'))
    expect(view.detail).toContain('4663')
    expect(view.detail).toContain('chain 1')
    expect(view.actions.map((action) => action.id)).toEqual(['switch-network', 'add-network', 'disconnect'])
  })

  it('shows the funding routes and the receive panel when unfunded', () => {
    const view = buildView(stateFor('unfunded'))
    expect(view.routes.length).toBeGreaterThan(1)
    expect(view.receive?.address).toBe(ACCOUNT)
    expect(view.actions.map((action) => action.id)).toContain('refresh-balances')
  })

  it('summarises the account once connected', () => {
    const view = buildView(stateFor('ready'))
    const labels = view.details.map((detail) => detail.label)
    expect(labels).toEqual(['Account', 'Wallet', 'Network', 'ETH', 'USDG'])
    expect(view.details.find((detail) => detail.label === 'ETH')?.value).toBe('1')
    expect(view.details.find((detail) => detail.label === 'USDG')?.value).toBe('5')
    expect(view.details[0]?.href).toContain('blockscout')
    expect(view.tone).toBe('success')
  })

  it('renders a retryable error with a retry action and the hint as guidance', () => {
    const error = new HoodConnectError('user-rejected', 'User rejected the request.')
    const view = buildView(stateFor('error', { error, step: 'connect' }))
    expect(view.title).toBe('Request declined')
    expect(view.detail).toContain(error.hint)
    expect(view.actions.map((action) => action.id)).toContain('retry')
    expect(view.tone).toBe('error')
  })

  it('offers no retry for an unrecoverable error, but still offers a way forward', () => {
    const error = new HoodConnectError('no-provider', 'No wallet was found on this page.')
    const view = buildView(stateFor('error', { error, step: 'connect', providers: [], provider: null, address: null }))
    const ids = view.actions.map((action) => action.id)
    expect(ids).not.toContain('retry')
    expect(ids).toContain('install')
    expect(ids).toContain('refresh-providers')
  })

  it('keeps the funding routes visible when the failure was on the fund step', () => {
    const error = new HoodConnectError('balance-read-failed', 'RPC unreachable')
    const view = buildView(stateFor('error', { error, step: 'fund' }))
    expect(view.stepIndex).toBe(3)
    expect(view.routes.length).toBeGreaterThan(0)
    expect(view.receive?.address).toBe(ACCOUNT)
  })

  it('honours label overrides and hides disconnect on request', () => {
    const view = buildView(stateFor('ready'), {
      labels: { readyTitle: 'All set', disconnect: 'Sign out' },
      showDisconnect: false,
    })
    expect(view.title).toBe('All set')
    expect(view.actions).toHaveLength(0)

    const withDisconnect = buildView(stateFor('ready'), { labels: { disconnect: 'Sign out' } })
    expect(withDisconnect.actions[0]?.label).toBe('Sign out')
  })

  it('accepts a custom install URL', () => {
    const view = buildView(stateFor('no-wallet'), { installUrl: 'https://example.com/wallets' })
    expect(view.actions.find((action) => action.id === 'install')?.href).toBe('https://example.com/wallets')
  })

  it('uses no em-dash in any generated copy', () => {
    for (const status of ALL_STATUSES) {
      const view = buildView(stateFor(status, { error: new HoodConnectError('unknown', 'x') }))
      const text = [view.title, view.detail, view.eyebrow, ...view.actions.map((action) => action.label)].join(' ')
      expect(text, status).not.toContain('—')
      expect(text, status).not.toContain('–')
    }
  })
})
