# Integrating hood-connect

Four ways to wire the flow into an app: React, Next.js (server rendering), wagmi, and a
plain HTML page. Every snippet below runs against the shipped code.

- [React (Vite, CRA, anything client-rendered)](#react)
- [Next.js and other server-rendered apps](#nextjs-and-other-server-rendered-apps)
- [wagmi](#wagmi)
- [Plain HTML, no bundler](#plain-html-no-bundler)
- [Headless: your own UI](#headless-your-own-ui)
- [Gating an action on readiness](#gating-an-action-on-readiness)
- [Customising the funding step](#customising-the-funding-step)
- [Troubleshooting](#troubleshooting)

---

## React

```bash
npm install hood-connect viem react react-dom
npm install qrcode-generator   # optional, adds the QR in the funding step
```

```tsx
// app.tsx
import { HoodConnect } from 'hood-connect/react'

export function App() {
  return (
    <HoodConnect
      config={{ chain: 'mainnet' }}
      theme="auto"
      onReady={(state) => console.log('ready:', state.address)}
      onError={(error) => console.warn(error.code, error.hint)}
    />
  )
}
```

That is the whole integration. The component discovers wallets over EIP-6963, restores a
previous session without prompting, adds and switches the network, reads balances, and shows
funding routes when the account has no gas.

To share one machine between a header button and a page body, wrap once:

```tsx
import { HoodConnectProvider, HoodConnect, useHoodConnect } from 'hood-connect/react'

function Header() {
  const hood = useHoodConnect()
  return <span>{hood.address ?? 'not connected'}</span>
}

export function App() {
  return (
    <HoodConnectProvider config={{ chain: 'mainnet' }}>
      <Header />
      <HoodConnect />
    </HoodConnectProvider>
  )
}
```

`useHoodConnect()` with no argument inside a provider reads that shared machine. Outside a
provider it creates its own, scoped to the calling component.

---

## Next.js and other server-rendered apps

`hood-connect` is SSR-safe by construction: the machine touches no browser API until its
`start()` runs inside an effect, and `useSyncExternalStore` gets a reference-stable server
snapshot. The server renders the `idle` state and the client takes over without a hydration
warning.

The component still uses hooks, so it belongs in a client component:

```tsx
// app/wallet.tsx
'use client'

import { HoodConnect } from 'hood-connect/react'

export function Wallet() {
  return <HoodConnect config={{ chain: 'mainnet' }} />
}
```

```tsx
// app/page.tsx  (stays a server component)
import { Wallet } from './wallet'

export default function Page() {
  return (
    <main>
      <h1>My dApp</h1>
      <Wallet />
    </main>
  )
}
```

The stylesheet renders inline with the component, so the server HTML is already styled and
there is no flash of unstyled content.

To verify SSR yourself:

```tsx
import { renderToString } from 'react-dom/server'
import { HoodConnect } from 'hood-connect/react'

const html = renderToString(<HoodConnect />)
console.log(html.includes('data-status="idle"'))  // true
```

---

## wagmi

wagmi ships no Robinhood Chain connector kit, so a dApp normally hand-writes the chain entry,
the transport, and a connector whose `switchChain` knows to add the network before switching.
This is all three:

```bash
npm install hood-connect viem wagmi @wagmi/core @tanstack/react-query
```

```ts
// wagmi.ts
import { createHoodConfig } from 'hood-connect/wagmi'

export const config = createHoodConfig({
  networks: ['mainnet', 'testnet'],
  ssr: true,
})
```

```tsx
// providers.tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from './wagmi'

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
```

```tsx
// connect-button.tsx
'use client'

import { useAccount, useConnect, useSwitchChain } from 'wagmi'

export function ConnectButton() {
  const { address, chainId } = useAccount()
  const { connect, connectors } = useConnect()
  const { switchChain } = useSwitchChain()

  if (!address) {
    return <button onClick={() => connect({ connector: connectors[0]! })}>Connect</button>
  }
  if (chainId !== 4663) {
    // Adds Robinhood Chain first if the wallet has never seen it.
    return <button onClick={() => switchChain({ chainId: 4663 })}>Switch network</button>
  }
  return <span>{address}</span>
}
```

Composing the config by hand instead:

```ts
import { createConfig } from 'wagmi'
import { hoodConnector, hoodTransports, hoodWagmiChains } from 'hood-connect/wagmi'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: hoodWagmiChains,
  transports: hoodTransports,
  connectors: [hoodConnector(), injected()],
})
```

Target one specific wallet by its EIP-6963 reverse-DNS name:

```ts
hoodConnector({ target: 'io.metamask', id: 'metamask', name: 'MetaMask' })
```

You can also mix the two surfaces: run wagmi for reads and writes, and mount `<HoodConnect />`
purely as the onboarding UI. They observe the same wallet, so a switch made in either is
reflected in both.

---

## Plain HTML, no bundler

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My dApp</title>
  <!-- Optional: adds a scannable QR to the funding step. -->
  <script src="https://unpkg.com/qrcode-generator@1.4.4/qrcode.js"></script>
</head>
<body>
  <hood-connect id="connect" chain="mainnet" theme="auto"></hood-connect>

  <script type="module">
    import 'https://unpkg.com/hood-connect/dist/element/index.js'

    const element = document.getElementById('connect')

    element.addEventListener('hood-connect:ready', (event) => {
      console.log('ready:', event.detail.address, 'chain', event.detail.chainId)
    })
    element.addEventListener('hood-connect:status', (event) => {
      document.body.dataset.walletStatus = event.detail.status
    })
    element.addEventListener('hood-connect:error', (event) => {
      console.warn(event.detail.code, event.detail.error.message)
    })
  </script>
</body>
</html>
```

### Attributes

| Attribute | Values | Default |
|---|---|---|
| `chain` | `mainnet`, `testnet`, `4663`, `46630` | `mainnet` |
| `theme` | `auto`, `light`, `dark` | `auto` |
| `rpc-url` | an HTTP RPC URL for balance reads | read through the wallet |
| `auto-connect` | `true`, `false` | `true` |
| `auto-switch-chain` | `true`, `false` | `false` |
| `require-funding` | `true`, `false` | `true` |
| `min-native-wei` | a decimal wei amount | `0` |
| `install-url` | where to send a user with no wallet | ethereum.org wallet finder |
| `show-qr` | `true`, `false` | `true` |
| `show-disconnect` | `true`, `false` | `true` |
| `unstyled` | present or absent | absent |

Changing `theme`, `unstyled`, `install-url`, `show-qr`, or `show-disconnect` restyles in
place. Changing any other attribute rebuilds the machine, which is what you want when
retargeting a network.

### Events

Every event bubbles and crosses the shadow boundary, so you can listen on an ancestor.

| Event | `detail` |
|---|---|
| `hood-connect:status` | `{ status, step, address, chainId, targetChainId, isFunded, state }` |
| `hood-connect:ready` | same, fired once per arrival at `ready` |
| `hood-connect:account` | same, fired whenever the account changes, including to `null` |
| `hood-connect:error` | the above plus `{ error, code }` |

The machine is reachable as `element.onboarding` and the current snapshot as `element.state`,
for anything the attributes do not cover:

```js
await element.onboarding.switchNetwork()
```

---

## Headless: your own UI

```tsx
import { useHoodConnect } from 'hood-connect/react'

export function Onboarding() {
  const hood = useHoodConnect({ chain: 'mainnet' })

  switch (hood.status) {
    case 'idle':
    case 'detecting':
      return <Spinner />
    case 'no-wallet':
      return <a href="https://ethereum.org/en/wallets/find-wallet/">Install a wallet</a>
    case 'disconnected':
      return (
        <ul>
          {hood.providers.map((wallet) => (
            <li key={wallet.info.uuid}>
              <button onClick={() => hood.connect(wallet)}>{wallet.info.name}</button>
            </li>
          ))}
        </ul>
      )
    case 'connecting':
      return <p>Check your wallet.</p>
    case 'locked':
      return <button onClick={() => hood.retry()}>Unlocked it, retry</button>
    case 'wrong-chain':
    case 'adding-chain':
    case 'switching-chain':
      return <button onClick={() => hood.switchNetwork()} disabled={hood.pending !== null}>Switch network</button>
    case 'checking-balance':
      return <Spinner />
    case 'unfunded':
      return (
        <ul>
          {hood.fundingRoutes.map((route) => (
            <li key={route.id}>{route.url ? <a href={route.url}>{route.label}</a> : route.address}</li>
          ))}
        </ul>
      )
    case 'ready':
      return <p>Connected: {hood.address}</p>
    case 'error':
      return (
        <div role="alert">
          <p>{hood.error?.hint}</p>
          {hood.error?.retryable ? <button onClick={() => hood.retry()}>Try again</button> : null}
        </div>
      )
  }
}
```

TypeScript will report a missing branch if a status goes unhandled, which is the point of the
exhaustive union.

Outside React, use the machine directly:

```ts
import { createOnboarding } from 'hood-connect'

const onboarding = createOnboarding({ chain: 'mainnet' })
const unsubscribe = onboarding.subscribe((state) => render(state))
onboarding.start()

// later
unsubscribe()
onboarding.destroy()
```

Actions never reject on a wallet-level failure. They resolve with the new state and put the
failure in `state.error`, so a click handler cannot leak an unhandled rejection:

```ts
const state = await onboarding.connect()
if (state.error) console.warn(state.error.code, state.error.hint)
```

---

## Gating an action on readiness

```tsx
import { useOnboardingStatus } from 'hood-connect/react'

export function TradeButton({ onTrade }: { onTrade: () => void }) {
  const status = useOnboardingStatus()
  return (
    <button onClick={onTrade} disabled={status !== 'ready'}>
      {status === 'ready' ? 'Trade' : 'Finish setup first'}
    </button>
  )
}
```

`useOnboardingStatus` returns only the status, so this button does not re-render when a
balance refreshes.

If your dApp is gasless or read-only, turn the funding step off and `ready` means connected
and on the right chain:

```tsx
<HoodConnect config={{ requireFunding: false }} />
```

To require more than a dust balance, set a floor:

```tsx
<HoodConnect config={{ minNativeWei: 200_000_000_000_000n }} />  // 0.0002 ETH
```

---

## Customising the funding step

Add your own onramp alongside the documented bridges:

```tsx
<HoodConnect
  config={{
    funding: {
      extraRoutes: [
        {
          id: 'card',
          label: 'Buy with a card',
          kind: 'bridge',
          description: 'Our onramp partner, around two minutes.',
          url: 'https://onramp.example.com?chain=4663',
          official: false,
        },
      ],
    },
  }}
/>
```

Replace the defaults entirely (the receive route is still appended, always):

```ts
funding: {
  routes: [
    { id: 'ours', label: 'Bridge', kind: 'bridge', description: 'Our bridge', url: 'https://bridge.example.com', official: false },
  ],
}
```

Show only the receive address:

```ts
funding: { disableDefaultBridges: true }
```

---

## Troubleshooting

**The card says "No wallet found" but a wallet is installed.**
The wallet did not answer EIP-6963. `hood-connect` keeps the verdict provisional for 600 ms
and folds in a legacy `window.ethereum`, so this usually means the extension injected very
late. Raise `detectionTimeoutMs`, or call `refreshProviders()`.

**"Your wallet cannot do this" (`unsupported-method`) when switching.**
The wallet does not implement `wallet_addEthereumChain`. Some mobile in-app browsers do not.
The user has to add Robinhood Chain manually from the wallet's network settings; the flow
says so and does not offer a pointless retry.

**A prompt is already open (`request-pending`, `-32002`).**
MetaMask queues one prompt per method and rejects the rest. The user must finish or dismiss
the open prompt. The error is marked retryable and the retry works once they do.

**Balances always read zero.**
Balances read through the connected wallet by default, which only works while the wallet is
on the target chain. If you are reading before the switch completes, pass `rpcUrl` so reads
go over HTTP instead:

```ts
createOnboarding({ rpcUrl: 'https://rpc.mainnet.chain.robinhood.com' })
```

That endpoint must send permissive CORS headers to be usable from a browser.

**No QR code in the funding step.**
`qrcode-generator` is an optional peer. Install it, or on a page with no bundler add its UMD
script tag: the loader checks the global before trying the import. Without it the address,
copy button, explorer link, and EIP-681 URI still render.

**Hydration mismatch in Next.js.**
`hood-connect` itself renders `idle` on the server and `idle` on the first client render. A
mismatch means something else in the tree reads `window` during render. Confirm with the
`renderToString` snippet above.

**The component ignores a changed `config` prop.**
Config is read once per machine, on first render. Remount to retarget:

```tsx
<HoodConnect key={network} config={{ chain: network }} />
```

**Multiple wallets and `connect()` reports `no-provider`.**
With more than one wallet installed the choice is ambiguous, so `connect()` with no argument
refuses rather than guessing. Pass the wallet: `connect(providers[0])`, or its rdns:
`connect('io.metamask')`. The bundled component renders a picker for you.
