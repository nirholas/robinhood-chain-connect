import { useState } from 'react'
import { HoodConnect, HoodConnectProvider, useHoodConnect } from 'hood-connect/react'
import type { HoodNetwork } from 'hood-connect'

/**
 * Two things this example demonstrates:
 *
 * 1. `<HoodConnect />`, the drop-in flow. Nothing to wire beyond the config.
 * 2. `useHoodConnect()`, the headless hook, driving a gated action next to it.
 *
 * Both read from the same machine because they sit under one
 * `<HoodConnectProvider>`, which is how you keep a header button and a page
 * body in agreement about whether the user can transact.
 */
export function App(): React.ReactElement {
  const [network, setNetwork] = useState<HoodNetwork>('mainnet')
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto')

  return (
    // Remounting on a network change gives the provider a fresh machine, which
    // is the intended way to retarget: config is read once per instance.
    <HoodConnectProvider key={network} config={{ chain: network }}>
      <main style={styles.page}>
        <header style={styles.header}>
          <h1 style={styles.h1}>hood-connect</h1>
          <p style={styles.lede}>
            Add network, fund, connect. One component for Robinhood Chain dApps.
          </p>
          <div style={styles.controls}>
            <label style={styles.label}>
              Network
              <select
                value={network}
                onChange={(event) => setNetwork(event.target.value as HoodNetwork)}
                style={styles.select}
              >
                <option value="mainnet">mainnet (4663)</option>
                <option value="testnet">testnet (46630)</option>
              </select>
            </label>
            <label style={styles.label}>
              Theme
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as 'auto' | 'light' | 'dark')}
                style={styles.select}
              >
                <option value="auto">auto</option>
                <option value="light">light</option>
                <option value="dark">dark</option>
              </select>
            </label>
          </div>
        </header>

        <section style={styles.columns}>
          <div>
            <h2 style={styles.h2}>The drop-in component</h2>
            <HoodConnect
              theme={theme}
              onReady={(state) => console.info('[hood-connect] ready:', state.address)}
              onError={(error) => console.warn('[hood-connect]', error.code, error.message)}
            />
          </div>

          <div>
            <h2 style={styles.h2}>The same state, headless</h2>
            <GatedAction />
          </div>
        </section>
      </main>
    </HoodConnectProvider>
  )
}

/**
 * A dApp action that is only safe once onboarding is complete. Every branch of
 * the status union is handled, which is what the exhaustive type buys you.
 */
function GatedAction(): React.ReactElement {
  const hood = useHoodConnect()

  return (
    <div style={styles.panel}>
      <dl style={styles.dl}>
        <dt style={styles.dt}>status</dt>
        <dd style={styles.dd}>{hood.status}</dd>
        <dt style={styles.dt}>step</dt>
        <dd style={styles.dd}>{hood.step}</dd>
        <dt style={styles.dt}>chain</dt>
        <dd style={styles.dd}>{hood.chainId ?? 'unknown'}</dd>
        <dt style={styles.dt}>account</dt>
        <dd style={styles.dd}>{hood.address ?? 'none'}</dd>
        <dt style={styles.dt}>wallets found</dt>
        <dd style={styles.dd}>{hood.providers.map((wallet) => wallet.info.name).join(', ') || 'none'}</dd>
      </dl>

      <button type="button" style={styles.button} disabled={hood.status !== 'ready'}>
        {hood.status === 'ready' ? 'Send a transaction' : `Blocked: ${nextStepFor(hood.status)}`}
      </button>
    </div>
  )
}

function nextStepFor(status: ReturnType<typeof useHoodConnect>['status']): string {
  switch (status) {
    case 'idle':
    case 'detecting':
      return 'looking for a wallet'
    case 'no-wallet':
      return 'install a wallet'
    case 'disconnected':
      return 'connect a wallet'
    case 'connecting':
      return 'approve the prompt'
    case 'locked':
      return 'unlock your wallet'
    case 'wrong-chain':
      return 'switch network'
    case 'adding-chain':
      return 'approve the network'
    case 'switching-chain':
      return 'approve the switch'
    case 'checking-balance':
      return 'reading your balance'
    case 'unfunded':
      return 'add funds'
    case 'error':
      return 'resolve the error'
    case 'ready':
      return 'nothing'
  }
}

const styles = {
  page: {
    font: '15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: 980,
    margin: '0 auto',
    padding: '48px 24px 80px',
  },
  header: { marginBottom: 36 },
  h1: { margin: 0, fontSize: 30, letterSpacing: '-0.02em' },
  h2: { margin: '0 0 14px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 },
  lede: { margin: '8px 0 20px', opacity: 0.7 },
  controls: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  label: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: 0.8 },
  select: { font: 'inherit', fontSize: 13, padding: '5px 8px', borderRadius: 8 },
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32, alignItems: 'start' },
  panel: { border: '1px solid rgba(128,128,128,0.35)', borderRadius: 14, padding: 20 },
  dl: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0 14px', margin: '0 0 18px' },
  dt: { fontSize: 12, opacity: 0.55, padding: '6px 0' },
  dd: {
    margin: 0,
    padding: '6px 0',
    textAlign: 'right',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    overflowWrap: 'anywhere',
  },
  button: {
    font: 'inherit',
    fontWeight: 600,
    width: '100%',
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid rgba(128,128,128,0.4)',
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>
