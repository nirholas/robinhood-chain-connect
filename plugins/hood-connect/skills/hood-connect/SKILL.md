---
name: hood-connect
description: Add wallet connect, add-network, and funding onboarding for Robinhood Chain (4663 mainnet, 46630 testnet) to a dApp with the hood-connect package, using React, wagmi or a plain web component. Use when a front end needs users on the right chain with gas.
---

# hood-connect

`hood-connect` models the first-visit flow for Robinhood Chain dApps as one state machine: detect wallets (EIP-6963), connect, add and switch to the chain, check balances, and offer funding routes. It ships a core, React bindings, a wagmi connector and a web component. Nothing in it signs a transaction or holds a key.

## Install

```bash
npm install hood-connect viem
```

Node 20+. `viem` is a peer dependency. `react`, `wagmi`, `@wagmi/core` and `qrcode-generator` are optional peers: install only what the entry point you import needs.

## Pick an entry point

React component:

```tsx
import { HoodConnect } from 'hood-connect/react'

export function Page() {
  return <HoodConnect config={{ chain: 'mainnet' }} theme="auto" onReady={(s) => console.log(s.address)} />
}
```

React headless hook (`useHoodConnect(config)` returns `status`, `address`, `fundingRoutes`, `pending`, and bound `connect`, `switchNetwork`, `addNetwork`, `refreshBalances`, `retry`, `disconnect`):

```tsx
const hood = useHoodConnect({ chain: 'mainnet' })
if (hood.status === 'wrong-chain') return <button onClick={() => hood.switchNetwork()}>Switch network</button>
```

wagmi:

```ts
import { createHoodConfig } from 'hood-connect/wagmi'
export const config = createHoodConfig({ networks: ['mainnet'], ssr: true })
```

Other wagmi exports: `hoodConnector`, `hoodTransports`, `hoodWagmiChains`, `robinhoodChain`, `robinhoodChainTestnet`.

Plain HTML:

```html
<script type="module" src="https://unpkg.com/hood-connect/dist/element/index.js"></script>
<hood-connect chain="mainnet" theme="auto"></hood-connect>
```

Element attributes: `chain`, `theme`, `rpc-url`, `auto-connect`, `auto-switch-chain`, `require-funding`, `min-native-wei`, `install-url`, `show-qr`, `show-disconnect`, `unstyled`. Events: `hood-connect:status`, `hood-connect:ready`, `hood-connect:account`, `hood-connect:error`.

## Core API (`hood-connect`)

`createOnboarding(config)` returns the machine (`getState`, `subscribe`, `start`, `connect`, `addNetwork`, `switchNetwork`, `refreshBalances`, `retry`, `disconnect`, `destroy`). `OnboardingConfig` keys: `chain`, `rpcUrl`, `requireFunding`, `minNativeWei`, `autoConnect`, `autoSwitchChain`, `funding`, `storage`, `storageKey`, `balanceRefreshIntervalMs`, `includeLegacyWindowEthereum`, `detectionTimeoutMs`. Also exported: `hoodMainnet`, `hoodTestnet`, `resolveHoodChain`, `buildFundingRoutes`, `readBalances`, `HoodConnectError`.

Statuses: `idle`, `detecting`, `no-wallet`, `disconnected`, `connecting`, `locked`, `wrong-chain`, `adding-chain`, `switching-chain`, `checking-balance`, `unfunded`, `ready`, `error`. A `switch` over `status` with no `default` fails to compile when a state is unhandled, so handle all of them.

Actions resolve with the new state and never reject on a wallet failure; read `state.error` (a `HoodConnectError` with `.code`, `.hint`, `.retryable`).

## Things to get right

- `config` is read once per machine. To change network, remount the component or create a new machine.
- Funding routes are links (Arbitrum bridge portal, Relay, Across, Stargate) plus a `receive` address with an EIP-681 QR. On testnet only `receive` is a default route; add others with `funding.extraRoutes`.
- The QR needs the optional `qrcode-generator` peer. Without it the address and copy button still render.
- Override styling with `--hc-*` CSS variables on `.hc-root`, or pass `unstyled`.

## Run the examples from a clone

```bash
git clone https://github.com/nirholas/robinhood-chain-connect
cd robinhood-chain-connect && npm install && npm run build
npm run example:react
npm run example:html
```
