import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOOD_CONNECT_EVENTS, HoodConnectElement, defineHoodConnectElement } from '../src/element/index.js'
import { hoodTestnet } from '../src/core/chains.js'
import { FakeProvider, announce, resetAnnouncements, rpcError, tick } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'

function visitorWallet(overrides: ConstructorParameters<typeof FakeProvider>[0] = {}): FakeProvider {
  return new FakeProvider({
    grantAccounts: [ACCOUNT],
    chainId: 1,
    knownChains: [1],
    nativeBalances: { [ACCOUNT.toLowerCase()]: 10n ** 18n },
    tokenBalances: { [ACCOUNT.toLowerCase()]: 1_000_000n },
    ...overrides,
  })
}

function mount(attributes: Record<string, string> = {}): HoodConnectElement {
  const element = document.createElement('hood-connect') as HoodConnectElement
  // A short detection window keeps the suite fast; 600ms is the shipped default.
  for (const [name, value] of Object.entries({ 'auto-connect': 'false', ...attributes })) {
    element.setAttribute(name, value)
  }
  document.body.appendChild(element)
  return element
}

function query(element: HoodConnectElement, selector: string): HTMLElement | null {
  return element.shadowRoot?.querySelector(selector) ?? null
}

function buttonLabelled(element: HoodConnectElement, pattern: RegExp): HTMLButtonElement | undefined {
  return [...(element.shadowRoot?.querySelectorAll('button') ?? [])].find((button) =>
    pattern.test(button.textContent ?? ''),
  )
}

afterEach(() => {
  document.body.replaceChildren()
  resetAnnouncements()
  window.localStorage.clear()
  delete (window as { ethereum?: unknown }).ethereum
})

describe('<hood-connect>', () => {
  it('registers itself on import and is idempotent', () => {
    expect(customElements.get('hood-connect')).toBe(HoodConnectElement)
    expect(defineHoodConnectElement()).toBe(false)
    expect(defineHoodConnectElement('hood-connect-alt')).toBe(true)
    expect(customElements.get('hood-connect-alt')).toBeTruthy()
  })

  it('renders into a shadow root with the stylesheet adopted', () => {
    const element = mount()
    expect(element.shadowRoot).toBeTruthy()
    expect(query(element, '.hc-root')).toBeTruthy()
    expect(element.shadowRoot?.querySelector('style')?.textContent).toContain('.hc-root')
  })

  it('starts the flow on connect and reaches the wallet picker', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    await tick(20)

    expect(element.state?.status).toBe('disconnected')
    expect(query(element, '.hc-title')?.textContent).toContain('Connect to Robinhood Chain')
    expect(buttonLabelled(element, /connect wallet/i)).toBeTruthy()
  })

  it('walks the full flow and emits status, account, and ready events', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    const statuses: string[] = []
    const ready = vi.fn()
    const account = vi.fn()
    element.addEventListener(HOOD_CONNECT_EVENTS.status, (event) => {
      statuses.push((event as CustomEvent<{ status: string }>).detail.status)
    })
    element.addEventListener(HOOD_CONNECT_EVENTS.ready, ready)
    element.addEventListener(HOOD_CONNECT_EVENTS.account, account)
    await tick(20)

    buttonLabelled(element, /connect wallet/i)?.click()
    await tick(20)
    expect(element.state?.status).toBe('wrong-chain')

    buttonLabelled(element, /^switch to robinhood chain$/i)?.click()
    await tick(30)

    expect(element.state?.status).toBe('ready')
    expect(statuses).toContain('connecting')
    expect(statuses.at(-1)).toBe('ready')
    expect(ready).toHaveBeenCalledTimes(1)
    const readyDetail = (ready.mock.calls[0]?.[0] as CustomEvent<{ address: string; isFunded: boolean }>).detail
    expect(readyDetail.address).toBe(ACCOUNT)
    expect(readyDetail.isFunded).toBe(true)
    expect(account).toHaveBeenCalled()
  })

  it('emits an error event carrying the normalised code', async () => {
    const wallet = visitorWallet()
    wallet.failNext('eth_requestAccounts', rpcError(4001, 'User rejected the request.'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    const element = mount()
    const onError = vi.fn()
    element.addEventListener(HOOD_CONNECT_EVENTS.error, onError)
    await tick(20)

    buttonLabelled(element, /connect wallet/i)?.click()
    await tick(20)

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as CustomEvent<{ code: string }>).detail.code).toBe('user-rejected')
    expect(query(element, '.hc-alert')?.textContent).toContain('user-rejected')
    expect(buttonLabelled(element, /try again/i)).toBeTruthy()
  })

  it('bubbles its events so a listener can sit on an ancestor', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const element = document.createElement('hood-connect') as HoodConnectElement
    element.setAttribute('auto-connect', 'false')
    const onStatus = vi.fn()
    document.body.addEventListener(HOOD_CONNECT_EVENTS.status, onStatus)
    host.appendChild(element)
    await tick(20)
    expect(onStatus).toHaveBeenCalled()
    document.body.removeEventListener(HOOD_CONNECT_EVENTS.status, onStatus)
  })

  it('reads its configuration from attributes', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount({ chain: 'testnet' })
    await tick(20)
    expect(element.state?.chain.id).toBe(hoodTestnet.id)

    const numeric = mount({ chain: '46630' })
    await tick(20)
    expect(numeric.state?.chain.id).toBe(hoodTestnet.id)
  })

  it('applies theme and unstyled without rebuilding the machine', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount({ theme: 'dark' })
    await tick(20)
    const machine = element.onboarding
    expect(query(element, '.hc-root')?.dataset['theme']).toBe('dark')

    element.setAttribute('theme', 'light')
    expect(query(element, '.hc-root')?.dataset['theme']).toBe('light')
    expect(element.onboarding).toBe(machine)

    element.setAttribute('unstyled', '')
    expect(element.shadowRoot?.querySelector('style')?.textContent).toBe('')
  })

  it('rebuilds the machine when the target chain changes', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    await tick(20)
    const machine = element.onboarding
    element.setAttribute('chain', 'testnet')
    await tick(20)
    expect(element.onboarding).not.toBe(machine)
    expect(machine?.isDestroyed()).toBe(true)
  })

  it('shows the funding step with routes and the receive address', async () => {
    announce(visitorWallet({ nativeBalances: {} }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    await tick(20)
    buttonLabelled(element, /connect wallet/i)?.click()
    await tick(20)
    buttonLabelled(element, /^switch to robinhood chain$/i)?.click()
    await tick(30)

    expect(element.state?.status).toBe('unfunded')
    const routes = element.shadowRoot?.querySelectorAll('.hc-route') ?? []
    expect(routes.length).toBeGreaterThan(1)
    expect((routes[0] as HTMLAnchorElement).href).toContain('portal.arbitrum.io')
    expect(query(element, '.hc-address')?.textContent).toBe(ACCOUNT)
    expect(buttonLabelled(element, /copy address/i)).toBeTruthy()
  })

  it('exposes the progress rail and a live region for screen readers', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    await tick(20)
    expect(element.shadowRoot?.querySelectorAll('.hc-rail-item')).toHaveLength(3)
    expect(query(element, '[aria-live="polite"]')?.textContent).toContain('Connect to Robinhood Chain')
    expect(query(element, '.hc-root')?.getAttribute('role')).toBe('region')
  })

  it('keeps a button identity stable across renders that do not change it', async () => {
    announce(visitorWallet({ nativeBalances: {} }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    await tick(20)
    buttonLabelled(element, /connect wallet/i)?.click()
    await tick(20)
    buttonLabelled(element, /^switch to robinhood chain$/i)?.click()
    await tick(30)

    const before = buttonLabelled(element, /check again/i)
    await element.onboarding?.refreshBalances()
    await tick(10)
    expect(buttonLabelled(element, /check again/i)).toBe(before)
  })

  it('tears the machine down when removed from the document', async () => {
    const wallet = visitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const element = mount()
    await tick(20)
    buttonLabelled(element, /connect wallet/i)?.click()
    await tick(20)
    expect(wallet.listenerCount('accountsChanged')).toBe(1)

    element.remove()
    expect(wallet.listenerCount('accountsChanged')).toBe(0)
    expect(element.onboarding).toBeNull()
  })
})
