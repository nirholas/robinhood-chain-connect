import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  createOnboarding,
  type Onboarding,
  type OnboardingConfig,
  type OnboardingState,
  type OnboardingStatus,
} from '../core/onboarding.js'
import type { HoodConnectError } from '../core/errors.js'
import type { Eip6963ProviderDetail } from '../core/provider.js'
import { generateQr, qrToSvgPath, qrViewBox, type QrMatrix } from '../ui/qr.js'
import { hoodConnectCss } from '../ui/styles.js'
import { buildView, type BuildViewOptions, type OnboardingView, type ViewAction, type ViewLabels } from '../ui/view.js'

/**
 * `hood-connect/react` provides the headless hooks and the drop-in
 * `<HoodConnect />` component.
 *
 * Everything here is SSR-safe. The onboarding machine touches no browser API
 * until its `start()` runs inside an effect, and `useSyncExternalStore` is
 * given a reference-stable server snapshot, so the server and the first client
 * render agree and hydration never warns.
 *
 * @packageDocumentation
 */

const OnboardingContext = createContext<Onboarding | null>(null)

/** Props for {@link HoodConnectProvider}. */
export interface HoodConnectProviderProps {
  /** Read once, when the instance is created. Later changes are ignored. */
  config?: OnboardingConfig
  children: ReactNode
}

/**
 * Share one onboarding machine across a tree, so every hook and component sees
 * the same wallet, chain, and balances.
 *
 * @example
 * ```tsx
 * import { HoodConnectProvider } from 'hood-connect/react'
 *
 * export function App({ children }: { children: React.ReactNode }) {
 *   return <HoodConnectProvider config={{ chain: 'mainnet' }}>{children}</HoodConnectProvider>
 * }
 * ```
 */
export function HoodConnectProvider({ config, children }: HoodConnectProviderProps): ReactNode {
  const onboarding = useManagedOnboarding(config)
  return <OnboardingContext.Provider value={onboarding}>{children}</OnboardingContext.Provider>
}

/**
 * Create (or reuse) an onboarding instance and drive its lifecycle.
 *
 * Recreates the machine if React's StrictMode double-invokes the mount effect
 * and destroys the first one, which is why the instance lives in state rather
 * than in a ref.
 */
function useManagedOnboarding(config: OnboardingConfig | undefined): Onboarding {
  const configRef = useRef(config)
  const [instance, setInstance] = useState<Onboarding>(() => createOnboarding(configRef.current ?? {}))

  useEffect(() => {
    if (instance.isDestroyed()) {
      setInstance(createOnboarding(configRef.current ?? {}))
      return
    }
    instance.start()
    return () => {
      instance.destroy()
    }
  }, [instance])

  return instance
}

/** The state plus the bound actions returned by {@link useHoodConnect}. */
export interface UseHoodConnectResult extends OnboardingState {
  /** Prompt the user to connect a wallet. */
  connect: (target?: string | Eip6963ProviderDetail) => Promise<OnboardingState>
  /** Switch the wallet to Robinhood Chain, adding it first if needed. */
  switchNetwork: () => Promise<OnboardingState>
  /** Add Robinhood Chain without switching to it. */
  addNetwork: () => Promise<OnboardingState>
  /** Re-read native and USDG balances. */
  refreshBalances: () => Promise<OnboardingState>
  /** Retry the action that last failed. */
  retry: () => Promise<OnboardingState>
  /** Drop the session. Pass `{ revoke: true }` to also revoke in the wallet. */
  disconnect: (options?: { revoke?: boolean }) => Promise<OnboardingState>
  /** Re-broadcast EIP-6963 discovery. */
  refreshProviders: () => void
  /** Clear the error without retrying. */
  clearError: () => void
  /** Escape hatch to the underlying machine. */
  onboarding: Onboarding
}

/**
 * The main hook: full onboarding state plus every action, bound.
 *
 * Uses the nearest {@link HoodConnectProvider} when there is one, and otherwise
 * creates a machine scoped to the calling component.
 *
 * @example
 * ```tsx
 * import { useHoodConnect } from 'hood-connect/react'
 *
 * export function Gate() {
 *   const hood = useHoodConnect({ chain: 'mainnet' })
 *   if (hood.status === 'ready') return <p>Connected: {hood.address}</p>
 *   if (hood.status === 'wrong-chain') return <button onClick={() => hood.switchNetwork()}>Switch</button>
 *   return <button onClick={() => hood.connect()} disabled={hood.pending !== null}>Connect</button>
 * }
 * ```
 */
export function useHoodConnect(config?: OnboardingConfig): UseHoodConnectResult {
  const fromContext = useContext(OnboardingContext)
  const local = useManagedOnboarding(fromContext ? undefined : config)
  const onboarding = fromContext ?? local

  const state = useSyncExternalStore(onboarding.subscribe, onboarding.getState, onboarding.getServerState)

  return useMemo<UseHoodConnectResult>(
    () => ({
      ...state,
      connect: onboarding.connect,
      switchNetwork: onboarding.switchNetwork,
      addNetwork: onboarding.addNetwork,
      refreshBalances: onboarding.refreshBalances,
      retry: onboarding.retry,
      disconnect: onboarding.disconnect,
      refreshProviders: onboarding.refreshProviders,
      clearError: onboarding.clearError,
      onboarding,
    }),
    [state, onboarding],
  )
}

/**
 * Just the discovered wallets, for building a custom wallet picker.
 *
 * @example
 * ```tsx
 * import { useProviders, useHoodConnect } from 'hood-connect/react'
 *
 * export function WalletList() {
 *   const providers = useProviders()
 *   const { connect } = useHoodConnect()
 *   return (
 *     <ul>
 *       {providers.map((wallet) => (
 *         <li key={wallet.info.uuid}>
 *           <button onClick={() => connect(wallet)}>{wallet.info.name}</button>
 *         </li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */
export function useProviders(config?: OnboardingConfig): readonly Eip6963ProviderDetail[] {
  return useHoodConnect(config).providers
}

/**
 * Just the status, for gating a route or a button without re-rendering on
 * every balance refresh.
 *
 * @example
 * ```tsx
 * import { useOnboardingStatus } from 'hood-connect/react'
 *
 * export function TradeButton() {
 *   const status = useOnboardingStatus()
 *   return <button disabled={status !== 'ready'}>Trade</button>
 * }
 * ```
 */
export function useOnboardingStatus(config?: OnboardingConfig): OnboardingStatus {
  return useHoodConnect(config).status
}

/** Props for {@link HoodConnect}. */
export interface HoodConnectProps extends BuildViewOptions {
  /** Onboarding configuration. Read once, on first render. */
  config?: OnboardingConfig
  /** @defaultValue `'auto'` (follows `prefers-color-scheme`) */
  theme?: 'auto' | 'light' | 'dark'
  /**
   * Skip the bundled stylesheet and style `.hc-*` yourself. The markup, the
   * classes, and the ARIA wiring stay exactly the same.
   */
  unstyled?: boolean
  /** Extra class names on the root element. */
  className?: string
  /** Copy overrides for every string the component renders. */
  labels?: ViewLabels
  /**
   * Render the EIP-681 QR code in the funding step. Requires the optional
   * `qrcode-generator` peer dependency; without it the address and copy
   * button render on their own.
   * @defaultValue `true`
   */
  showQrCode?: boolean
  /** Fires on every status transition. */
  onStatusChange?: (status: OnboardingStatus, state: OnboardingState) => void
  /** Fires once each time the flow reaches `ready`. */
  onReady?: (state: OnboardingState) => void
  /** Fires whenever a new error is recorded. */
  onError?: (error: HoodConnectError, state: OnboardingState) => void
}

/**
 * The whole three-step onboarding flow in one element.
 *
 * @example
 * ```tsx
 * import { HoodConnect } from 'hood-connect/react'
 *
 * export function Page() {
 *   return (
 *     <HoodConnect
 *       config={{ chain: 'mainnet' }}
 *       theme="auto"
 *       onReady={(state) => console.log('ready', state.address)}
 *     />
 *   )
 * }
 * ```
 */
export function HoodConnect(props: HoodConnectProps): ReactNode {
  const hood = useHoodConnect(props.config)
  const theme = props.theme ?? 'auto'
  const showQrCode = props.showQrCode ?? true

  const view = useMemo(
    () =>
      buildView(hood, {
        ...(props.labels ? { labels: props.labels } : {}),
        ...(props.installUrl ? { installUrl: props.installUrl } : {}),
        ...(props.showDisconnect === undefined ? {} : { showDisconnect: props.showDisconnect }),
      }),
    [hood, props.labels, props.installUrl, props.showDisconnect],
  )

  useLifecycleCallbacks(hood, props)

  const dispatch = useCallback(
    (action: ViewAction) => {
      if (action.providerUuid) {
        void hood.connect(action.providerUuid)
        return
      }
      switch (action.id) {
        case 'connect':
          void hood.connect()
          return
        case 'switch-network':
          void hood.switchNetwork()
          return
        case 'add-network':
          void hood.addNetwork()
          return
        case 'refresh-balances':
          void hood.refreshBalances()
          return
        case 'retry':
          void hood.retry()
          return
        case 'disconnect':
          void hood.disconnect()
          return
        case 'refresh-providers':
          hood.refreshProviders()
          return
        default:
          return
      }
    },
    [hood],
  )

  return (
    <div
      className={['hc-root', props.className].filter(Boolean).join(' ')}
      data-theme={theme}
      data-tone={view.tone}
      data-status={view.status}
      role="region"
      aria-label={`${hood.chain.name} wallet onboarding`}
      aria-busy={view.busy}
    >
      {props.unstyled ? null : <style>{hoodConnectCss}</style>}

      <StepRail view={view} />

      <p className="hc-eyebrow">{view.eyebrow}</p>
      <h2 className="hc-title">
        {view.busy ? <span className="hc-spinner" aria-hidden="true" /> : null}
        {view.title}
      </h2>
      <p className="hc-detail">{view.detail}</p>

      <p className="hc-sr" role="status" aria-live="polite">
        {`${view.title}. ${view.detail}`}
      </p>

      {hood.error ? (
        <div className="hc-alert" role="alert">
          <span className="hc-alert-code">{hood.error.code}</span> {hood.error.hint}
        </div>
      ) : null}

      {view.walletChoices.length > 0 ? (
        <div className="hc-wallets" role="group" aria-label="Choose a wallet">
          {view.walletChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="hc-btn hc-wallet"
              data-kind="secondary"
              disabled={view.busy}
              aria-label={choice.ariaLabel ?? choice.label}
              onClick={() => dispatch(choice)}
            >
              {choice.iconUrl ? <img className="hc-wallet-icon" src={choice.iconUrl} alt="" /> : <span className="hc-wallet-icon" aria-hidden="true" />}
              <span className="hc-wallet-name">{choice.label}</span>
              {choice.busy ? <span className="hc-spinner" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {view.details.length > 0 ? (
        <dl className="hc-details">
          {view.details.map((detail) => (
            <div key={detail.label} style={{ display: 'contents' }}>
              <dt>{detail.label}</dt>
              <dd className={detail.mono ? 'hc-mono' : undefined}>
                {detail.href ? (
                  <a href={detail.href} target="_blank" rel="noreferrer noopener">
                    {detail.value}
                  </a>
                ) : (
                  detail.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {view.routes.length > 0 ? (
        <div className="hc-routes" role="group" aria-label="Ways to add funds">
          {view.routes
            .filter((route) => route.kind === 'bridge' && route.url)
            .map((route) => (
              <a key={route.id} className="hc-route" href={route.url} target="_blank" rel="noreferrer noopener">
                <span className="hc-route-label">
                  {route.label}
                  <span className="hc-route-arrow" aria-hidden="true">
                    {String.fromCharCode(8599)}
                  </span>
                </span>
                <span className="hc-route-desc">{route.description}</span>
              </a>
            ))}
        </div>
      ) : null}

      {view.receive?.address ? <ReceivePanel route={view.receive} showQrCode={showQrCode} /> : null}

      {view.actions.length > 0 ? (
        <div className="hc-actions">
          {view.actions.map((action) =>
            action.href ? (
              <a
                key={action.id}
                className="hc-btn"
                data-kind={action.kind}
                href={action.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.id}
                type="button"
                className="hc-btn"
                data-kind={action.kind}
                disabled={view.busy}
                aria-label={action.ariaLabel ?? action.label}
                onClick={() => dispatch(action)}
              >
                {action.busy ? <span className="hc-spinner" aria-hidden="true" /> : null}
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

function StepRail({ view }: { view: OnboardingView }): ReactNode {
  return (
    <div className="hc-rail" role="list" aria-label="Onboarding progress">
      {view.steps.map((stepLabel, index) => {
        const position = index + 1
        const done = view.status === 'ready' ? true : position < view.stepIndex
        const active = view.status !== 'ready' && position === view.stepIndex
        return (
          <div
            key={stepLabel}
            className="hc-rail-item"
            role="listitem"
            data-state={done ? 'done' : active ? 'active' : 'todo'}
            aria-current={active ? 'step' : undefined}
          >
            <span className="hc-rail-bar" aria-hidden="true" />
            <span className="hc-rail-label">{stepLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

function ReceivePanel({
  route,
  showQrCode,
}: {
  route: NonNullable<OnboardingView['receive']>
  showQrCode: boolean
}): ReactNode {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null)
  const [copied, setCopied] = useState(false)
  const address = route.address ?? ''
  const uri = route.uri ?? ''

  useEffect(() => {
    if (!showQrCode || !uri) {
      setMatrix(null)
      return
    }
    let active = true
    void generateQr(uri).then((result) => {
      if (active) setMatrix(result)
    })
    return () => {
      active = false
    }
  }, [uri, showQrCode])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = useCallback(() => {
    void writeToClipboard(address).then(setCopied)
  }, [address])

  return (
    <div className="hc-receive">
      <p className="hc-receive-head">{route.label}</p>
      <p className="hc-receive-desc">{route.description}</p>
      <div className="hc-receive-body">
        {matrix ? (
          <div className="hc-qr">
            <svg viewBox={qrViewBox(matrix)} role="img" aria-label={`QR code for ${uri}`}>
              <rect x={-4} y={-4} width={matrix.size + 8} height={matrix.size + 8} fill="#ffffff" />
              <path d={qrToSvgPath(matrix)} fill="#000000" />
            </svg>
          </div>
        ) : null}
        <div className="hc-receive-fields">
          <p className="hc-address">{address}</p>
          <button type="button" className="hc-btn hc-copy" data-kind="secondary" data-copied={copied} onClick={copy}>
            {copied ? 'Copied' : 'Copy address'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Copy text, preferring the async Clipboard API and falling back to a
 * selection-based copy for browsers that gate it behind permissions.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection path below.
  }
  if (typeof document === 'undefined') return false
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(field)
  return ok
}

function useLifecycleCallbacks(state: OnboardingState, props: HoodConnectProps): void {
  const previousStatus = useRef<OnboardingStatus | null>(null)
  const previousError = useRef<HoodConnectError | null>(null)
  const { onStatusChange, onReady, onError } = props

  useEffect(() => {
    if (previousStatus.current !== state.status) {
      previousStatus.current = state.status
      onStatusChange?.(state.status, state)
      if (state.status === 'ready') onReady?.(state)
    }
    if (state.error && state.error !== previousError.current) {
      previousError.current = state.error
      onError?.(state.error, state)
    }
    if (!state.error) previousError.current = null
  }, [state, onStatusChange, onReady, onError])
}

export type {
  Onboarding,
  OnboardingConfig,
  OnboardingState,
  OnboardingStatus,
  OnboardingView,
  ViewAction,
  ViewLabels,
}
