import { StrictMode, type ReactElement } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoodConnect, HoodConnectProvider, useHoodConnect, useOnboardingStatus, useProviders } from '../src/react/index.js'
import { hoodMainnet } from '../src/core/chains.js'
import { FakeProvider, announce, resetAnnouncements, rpcError } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const CONFIG = { detectionTimeoutMs: 5, balanceRefreshIntervalMs: 0 } as const

function visitorWallet(overrides: ConstructorParameters<typeof FakeProvider>[0] = {}): FakeProvider {
  return new FakeProvider({
    grantAccounts: [ACCOUNT],
    chainId: 1,
    knownChains: [1],
    nativeBalances: { [ACCOUNT.toLowerCase()]: 2_000_000_000_000_000_000n },
    tokenBalances: { [ACCOUNT.toLowerCase()]: 25_000_000n },
    ...overrides,
  })
}

afterEach(() => {
  cleanup()
  resetAnnouncements()
  window.localStorage.clear()
  delete (window as { ethereum?: unknown }).ethereum
})

describe('<HoodConnect />', () => {
  it('renders the detecting state first, then the install prompt when nothing answers', async () => {
    render(<HoodConnect config={CONFIG} />)
    expect(screen.getByRole('heading', { name: /looking for your wallet/i })).toBeTruthy()

    expect(await screen.findByRole('heading', { name: /no wallet found/i })).toBeTruthy()
    const install = screen.getByRole('link', { name: /get a wallet/i })
    expect(install.getAttribute('href')).toContain('https://')
    expect(install.getAttribute('rel')).toContain('noopener')
    expect(screen.getByRole('button', { name: /i installed one/i })).toBeTruthy()
  })

  it('walks a first-time visitor through connect, switch, and ready', async () => {
    const user = userEvent.setup()
    const wallet = visitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onReady = vi.fn()

    render(<HoodConnect config={CONFIG} onReady={onReady} />)

    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))

    expect(await screen.findByRole('heading', { name: /switch to robinhood chain/i })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^switch to robinhood chain$/i }))

    expect(await screen.findByRole('heading', { name: /you are ready/i })).toBeTruthy()
    expect(wallet.countOf('wallet_addEthereumChain')).toBe(1)

    const details = screen.getByRole('region').querySelector('dl')
    expect(details?.textContent).toContain('0x1111...1111')
    expect(details?.textContent).toContain('MetaMask')
    expect(details?.textContent).toContain('25')
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  })

  it('renders a wallet picker when several wallets are installed', async () => {
    const user = userEvent.setup()
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    announce(visitorWallet(), { uuid: 'u2', name: 'Rabby', rdns: 'io.rabby' })

    render(<HoodConnect config={CONFIG} />)

    const group = await screen.findByRole('group', { name: /choose a wallet/i })
    expect(within(group).getAllByRole('button')).toHaveLength(2)

    await user.click(within(group).getByRole('button', { name: /connect with rabby/i }))
    expect(await screen.findByRole('heading', { name: /switch to robinhood chain/i })).toBeTruthy()
  })

  it('shows a designed, actionable error when the user rejects, and recovers on retry', async () => {
    const user = userEvent.setup()
    const wallet = visitorWallet()
    wallet.failNext('eth_requestAccounts', rpcError(4001, 'User rejected the request.'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const onError = vi.fn()

    render(<HoodConnect config={CONFIG} onError={onError} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))

    expect(await screen.findByRole('heading', { name: /request declined/i })).toBeTruthy()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('user-rejected')
    expect(alert.textContent).toMatch(/try again when you are ready/i)
    await waitFor(() => expect(onError).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: /switch to robinhood chain/i })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the locked state with its own recovery path', async () => {
    const user = userEvent.setup()
    announce(visitorWallet({ grantAccounts: [] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    render(<HoodConnect config={CONFIG} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))

    expect(await screen.findByRole('heading', { name: /your wallet is locked/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('renders the funding step with bridge routes and a copyable address', async () => {
    const user = userEvent.setup()
    announce(visitorWallet({ nativeBalances: {} }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    render(<HoodConnect config={CONFIG} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))
    await user.click(await screen.findByRole('button', { name: /^switch to robinhood chain$/i }))

    expect(await screen.findByRole('heading', { name: /add funds on robinhood chain/i })).toBeTruthy()

    const routes = screen.getByRole('group', { name: /ways to add funds/i })
    const links = within(routes).getAllByRole('link')
    expect(links.length).toBeGreaterThan(1)
    expect(links[0]?.getAttribute('href')).toContain('portal.arbitrum.io')

    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    expect(screen.getByRole('button', { name: /check again/i })).toBeTruthy()
  })

  it('advances out of the funding step once a balance arrives', async () => {
    const user = userEvent.setup()
    const wallet = visitorWallet({ nativeBalances: {} })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    render(<HoodConnect config={CONFIG} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))
    await user.click(await screen.findByRole('button', { name: /^switch to robinhood chain$/i }))
    await screen.findByRole('heading', { name: /add funds/i })

    wallet.nativeBalances[ACCOUNT.toLowerCase()] = 10n ** 18n
    await user.click(screen.getByRole('button', { name: /check again/i }))

    expect(await screen.findByRole('heading', { name: /you are ready/i })).toBeTruthy()
  })

  it('disconnects back to the first step', async () => {
    const user = userEvent.setup()
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    render(<HoodConnect config={{ ...CONFIG, autoConnect: false }} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))
    await user.click(await screen.findByRole('button', { name: /^switch to robinhood chain$/i }))
    await screen.findByRole('heading', { name: /you are ready/i })

    await user.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(await screen.findByRole('heading', { name: /connect to robinhood chain/i })).toBeTruthy()
  })

  it('reports every status transition in order', async () => {
    const user = userEvent.setup()
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const seen: string[] = []

    render(<HoodConnect config={CONFIG} onStatusChange={(status) => seen.push(status)} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))
    await user.click(await screen.findByRole('button', { name: /^switch to robinhood chain$/i }))
    await screen.findByRole('heading', { name: /you are ready/i })

    expect(seen).toContain('disconnected')
    expect(seen).toContain('wrong-chain')
    expect(seen.at(-1)).toBe('ready')
  })

  it('marks the card busy while it is still looking for a wallet', () => {
    render(<HoodConnect config={CONFIG} />)
    const region = screen.getByRole('region', { name: /robinhood chain wallet onboarding/i })
    expect(region.getAttribute('aria-busy')).toBe('true')
  })

  it('is accessible: labelled region, live status, focusable controls, busy flag', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    render(<HoodConnect config={CONFIG} />)

    const connect = await screen.findByRole('button', { name: /connect wallet/i })
    expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('status').textContent).toContain('Connect to Robinhood Chain')
    expect(screen.getByRole('list', { name: /onboarding progress/i })).toBeTruthy()

    connect.focus()
    expect(document.activeElement).toBe(connect)
  })

  it('honours the theme prop and the unstyled escape hatch', async () => {
    const { container, rerender } = render(<HoodConnect config={CONFIG} theme="dark" />)
    const root = container.querySelector('.hc-root') as HTMLElement
    expect(root.dataset['theme']).toBe('dark')
    expect(container.querySelector('style')).not.toBeNull()

    rerender(<HoodConnect config={CONFIG} theme="light" unstyled className="mine" />)
    expect(root.dataset['theme']).toBe('light')
    expect(root.classList.contains('mine')).toBe(true)
    expect(container.querySelector('style')).toBeNull()
  })

  it('survives React StrictMode, which mounts and unmounts every effect twice', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    render(
      <StrictMode>
        <HoodConnect config={CONFIG} />
      </StrictMode>,
    )
    expect(await screen.findByRole('button', { name: /connect wallet/i })).toBeTruthy()
  })

  it('detaches provider listeners when it unmounts', async () => {
    const user = userEvent.setup()
    const wallet = visitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    const { unmount } = render(<HoodConnect config={CONFIG} />)
    await user.click(await screen.findByRole('button', { name: /connect wallet/i }))
    expect(wallet.listenerCount('accountsChanged')).toBe(1)

    unmount()
    expect(wallet.listenerCount('accountsChanged')).toBe(0)
  })
})

describe('hooks', () => {
  function Probe(): ReactElement {
    const hood = useHoodConnect()
    return (
      <div>
        <span data-testid="status">{hood.status}</span>
        <span data-testid="chain">{hood.chain.id}</span>
        <button type="button" onClick={() => void hood.connect()}>
          go
        </button>
      </div>
    )
  }

  function StatusOnly(): ReactElement {
    return <span data-testid="only">{useOnboardingStatus()}</span>
  }

  function ProviderNames(): ReactElement {
    return <span data-testid="names">{useProviders().map((wallet) => wallet.info.name).join(',')}</span>
  }

  it('shares one machine across the tree through the provider', async () => {
    const user = userEvent.setup()
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })

    render(
      <HoodConnectProvider config={CONFIG}>
        <Probe />
        <StatusOnly />
        <ProviderNames />
      </HoodConnectProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('disconnected'))
    expect(screen.getByTestId('only').textContent).toBe('disconnected')
    expect(screen.getByTestId('names').textContent).toBe('MetaMask')
    expect(screen.getByTestId('chain').textContent).toBe(String(hoodMainnet.id))

    await user.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('wrong-chain'))
    expect(screen.getByTestId('only').textContent).toBe('wrong-chain')
  })

  it('works standalone, with no provider in the tree', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('disconnected'))
  })

  it('renders idle on the server snapshot, so hydration cannot mismatch', async () => {
    let markup = ''
    await act(async () => {
      const { renderToString } = await import('react-dom/server')
      markup = renderToString(<HoodConnect config={CONFIG} />)
    })
    expect(markup).toContain('Looking for your wallet')
    expect(markup).toContain('data-status="idle"')
  })
})
