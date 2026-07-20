import { formatBalance, shortenAddress } from '../core/format.js'
import type { FundingRoute } from '../core/funding.js'
import type { OnboardingState, OnboardingStatus, OnboardingStep } from '../core/onboarding.js'

/**
 * A pure state-to-view projection shared by the React component and the web
 * component.
 *
 * Keeping this separate from both renderers is what stops the two UIs drifting:
 * there is exactly one place that decides what a status says, which buttons it
 * offers, and what the user should do next. It is also the piece worth testing,
 * because it is where "every state is designed" is actually enforced.
 */

/** A button or link the view offers. */
export interface ViewAction {
  /** Stable identifier the renderer dispatches back. */
  id: string
  label: string
  kind: 'primary' | 'secondary' | 'link' | 'ghost'
  /** Present for link actions. Opened in a new tab. */
  href?: string
  /** Render a spinner and disable interaction. */
  busy?: boolean
  /** Accessible description when the label alone is not enough. */
  ariaLabel?: string
  /** The wallet to connect, for multi-wallet choice actions. */
  providerUuid?: string
  /** Icon data URI, for wallet choice actions. */
  iconUrl?: string
}

/** A labelled key/value shown in the account summary. */
export interface ViewDetail {
  label: string
  value: string
  /** A link for the value, when there is a useful destination. */
  href?: string
  /** Render with a monospace face (addresses, balances). */
  mono?: boolean
}

/** Everything a renderer needs. No renderer decides copy on its own. */
export interface OnboardingView {
  status: OnboardingStatus
  step: OnboardingStep
  /** 1, 2, or 3. `3` once the flow is done, so the progress bar stays full. */
  stepIndex: 1 | 2 | 3
  /** The three step labels, for the progress rail. */
  steps: readonly [string, string, string]
  /** Short status line above the title, e.g. "Step 1 of 3". */
  eyebrow: string
  title: string
  /** One or two sentences telling the user exactly what happens next. */
  detail: string
  tone: 'neutral' | 'busy' | 'error' | 'success'
  /** True while an action is in flight. Renderers disable the whole card. */
  busy: boolean
  actions: readonly ViewAction[]
  /** Wallet choices, when the user has more than one installed. */
  walletChoices: readonly ViewAction[]
  /** Funding routes, populated only in the funding step. */
  routes: readonly FundingRoute[]
  /** Account summary, populated once connected. */
  details: readonly ViewDetail[]
  /** The receive route, hoisted so renderers can show a QR or copy field. */
  receive: FundingRoute | null
}

/** Copy overrides. Every string the component renders is replaceable. */
export interface ViewLabels {
  stepConnect?: string
  stepNetwork?: string
  stepFund?: string
  connect?: string
  connecting?: string
  switchNetwork?: string
  addNetwork?: string
  retry?: string
  disconnect?: string
  installWallet?: string
  refreshBalance?: string
  readyTitle?: string
  readyDetail?: string
}

/** Options for {@link buildView}. */
export interface BuildViewOptions {
  labels?: ViewLabels
  /**
   * Where to send a user with no wallet. Defaults to ethereum.org's wallet
   * finder, which is vendor-neutral rather than steering people at one wallet.
   */
  installUrl?: string
  /** Show the disconnect action once connected. @defaultValue `true` */
  showDisconnect?: boolean
}

const DEFAULT_INSTALL_URL = 'https://ethereum.org/en/wallets/find-wallet/'

function label(labels: ViewLabels | undefined, key: keyof ViewLabels, fallback: string): string {
  return labels?.[key] ?? fallback
}

function stepIndexFor(step: OnboardingStep): 1 | 2 | 3 {
  if (step === 'connect') return 1
  if (step === 'network') return 2
  return 3
}

function walletChoiceActions(state: OnboardingState): ViewAction[] {
  return state.providers.map((detail) => ({
    id: `connect:${detail.info.uuid}`,
    label: detail.info.name,
    kind: 'secondary' as const,
    providerUuid: detail.info.uuid,
    ariaLabel: `Connect with ${detail.info.name}`,
    ...(detail.info.icon ? { iconUrl: detail.info.icon } : {}),
    ...(state.pending === 'connect' && state.provider?.info.uuid === detail.info.uuid ? { busy: true } : {}),
  }))
}

function accountDetails(state: OnboardingState): ViewDetail[] {
  const details: ViewDetail[] = []
  if (state.address) {
    details.push({
      label: 'Account',
      value: shortenAddress(state.address),
      href: `${state.chain.explorerUrl}/address/${state.address}`,
      mono: true,
    })
  }
  if (state.provider) {
    details.push({ label: 'Wallet', value: state.provider.info.name })
  }
  details.push({ label: 'Network', value: state.chain.name })
  if (state.balances) {
    details.push({ label: 'ETH', value: formatBalance(state.balances.native, 18, 5), mono: true })
    details.push({ label: 'USDG', value: formatBalance(state.balances.usdg, 6, 2), mono: true })
  }
  return details
}

/**
 * Project an {@link OnboardingState} into a fully designed view.
 *
 * Every status in the union produces a title, a detail sentence, and at least
 * one action, so there is no state that renders as an empty box.
 *
 * @example
 * ```ts
 * import { createOnboarding, buildView } from 'hood-connect'
 *
 * const onboarding = createOnboarding()
 * const view = buildView(onboarding.getState())
 * console.log(view.title, view.actions.map((action) => action.id))
 * ```
 */
export function buildView(state: OnboardingState, options: BuildViewOptions = {}): OnboardingView {
  const { labels } = options
  const installUrl = options.installUrl ?? DEFAULT_INSTALL_URL
  const showDisconnect = options.showDisconnect ?? true

  const steps: readonly [string, string, string] = [
    label(labels, 'stepConnect', 'Connect'),
    label(labels, 'stepNetwork', 'Network'),
    label(labels, 'stepFund', 'Fund'),
  ]

  const stepIndex = stepIndexFor(state.step)
  const details = accountDetails(state)
  const receive = state.fundingRoutes.find((route) => route.kind === 'receive') ?? null
  const disconnectAction: ViewAction = {
    id: 'disconnect',
    label: label(labels, 'disconnect', 'Disconnect'),
    kind: 'ghost',
  }

  const base = {
    status: state.status,
    step: state.step,
    stepIndex,
    steps,
    walletChoices: [] as readonly ViewAction[],
    routes: [] as readonly FundingRoute[],
    details: [] as readonly ViewDetail[],
    receive: null as FundingRoute | null,
    busy: state.pending !== null,
  }

  switch (state.status) {
    case 'idle':
    case 'detecting':
      return {
        ...base,
        eyebrow: `Step 1 of 3 ${String.fromCharCode(183)} ${steps[0]}`,
        title: 'Looking for your wallet',
        detail: `Checking which wallets are installed in this browser.`,
        tone: 'busy',
        busy: true,
        actions: [],
      }

    case 'no-wallet':
      return {
        ...base,
        eyebrow: `Step 1 of 3 ${String.fromCharCode(183)} ${steps[0]}`,
        title: 'No wallet found',
        detail: `You need a browser wallet to use ${state.chain.name}. Install one, then reload this page.`,
        tone: 'neutral',
        actions: [
          {
            id: 'install',
            label: label(labels, 'installWallet', 'Get a wallet'),
            kind: 'primary',
            href: installUrl,
          },
          { id: 'refresh-providers', label: 'I installed one', kind: 'ghost' },
        ],
      }

    case 'disconnected': {
      const choices = walletChoiceActions(state)
      const single = state.providers.length === 1
      return {
        ...base,
        eyebrow: `Step 1 of 3 ${String.fromCharCode(183)} ${steps[0]}`,
        title: `Connect to ${state.chain.name}`,
        detail: single
          ? `Approve the prompt in ${state.providers[0]?.info.name ?? 'your wallet'} to continue.`
          : 'Pick the wallet you want to use.',
        tone: 'neutral',
        walletChoices: single ? [] : choices,
        actions: single
          ? [{ id: 'connect', label: label(labels, 'connect', 'Connect wallet'), kind: 'primary' }]
          : [],
      }
    }

    case 'connecting':
      return {
        ...base,
        eyebrow: `Step 1 of 3 ${String.fromCharCode(183)} ${steps[0]}`,
        title: label(labels, 'connecting', 'Check your wallet'),
        detail: `Approve the connection request in ${state.provider?.info.name ?? 'your wallet'}. This page is waiting.`,
        tone: 'busy',
        busy: true,
        actions: [],
      }

    case 'locked':
      return {
        ...base,
        eyebrow: `Step 1 of 3 ${String.fromCharCode(183)} ${steps[0]}`,
        title: 'Your wallet is locked',
        detail: `${state.provider?.info.name ?? 'Your wallet'} did not share an account. Unlock it, or re-enable this site in its connected-sites list, then try again.`,
        tone: 'error',
        actions: [{ id: 'retry', label: label(labels, 'retry', 'Try again'), kind: 'primary' }],
      }

    case 'wrong-chain':
      return {
        ...base,
        details,
        eyebrow: `Step 2 of 3 ${String.fromCharCode(183)} ${steps[1]}`,
        title: `Switch to ${state.chain.name}`,
        detail: `Your wallet is on chain ${String(state.chainId ?? 'unknown')}. This app runs on ${state.chain.name} (chain ${String(state.chain.id)}). If the network is not in your wallet yet, it gets added for you.`,
        tone: 'neutral',
        actions: [
          {
            id: 'switch-network',
            label: label(labels, 'switchNetwork', `Switch to ${state.chain.name}`),
            kind: 'primary',
          },
          { id: 'add-network', label: label(labels, 'addNetwork', 'Add network only'), kind: 'secondary' },
          ...(showDisconnect ? [disconnectAction] : []),
        ],
      }

    case 'adding-chain':
      return {
        ...base,
        details,
        eyebrow: `Step 2 of 3 ${String.fromCharCode(183)} ${steps[1]}`,
        title: 'Adding the network',
        detail: `Approve the "Add network" prompt in your wallet. It shows the RPC ${state.chain.rpcUrl} and chain ID ${String(state.chain.id)}.`,
        tone: 'busy',
        busy: true,
        actions: [],
      }

    case 'switching-chain':
      return {
        ...base,
        details,
        eyebrow: `Step 2 of 3 ${String.fromCharCode(183)} ${steps[1]}`,
        title: 'Switching network',
        detail: 'Approve the network switch in your wallet. If the network is missing, your wallet asks to add it first.',
        tone: 'busy',
        busy: true,
        actions: [],
      }

    case 'checking-balance':
      return {
        ...base,
        details,
        eyebrow: `Step 3 of 3 ${String.fromCharCode(183)} ${steps[2]}`,
        title: 'Checking your balance',
        detail: `Reading your ETH and USDG balances on ${state.chain.name}.`,
        tone: 'busy',
        busy: true,
        actions: [],
      }

    case 'unfunded':
      return {
        ...base,
        details,
        routes: state.fundingRoutes,
        receive,
        eyebrow: `Step 3 of 3 ${String.fromCharCode(183)} ${steps[2]}`,
        title: `Add funds on ${state.chain.name}`,
        detail: `You are connected, but this account has no ETH on ${state.chain.name} to pay for gas. Bridge in, or send ETH straight to your address. The balance refreshes on its own.`,
        tone: 'neutral',
        actions: [
          {
            id: 'refresh-balances',
            label: label(labels, 'refreshBalance', 'Check again'),
            kind: 'secondary',
          },
          ...(showDisconnect ? [disconnectAction] : []),
        ],
      }

    case 'ready':
      return {
        ...base,
        details,
        eyebrow: `${state.chain.name} ${String.fromCharCode(183)} connected`,
        title: label(labels, 'readyTitle', 'You are ready'),
        detail: label(
          labels,
          'readyDetail',
          `Connected to ${state.chain.name} with funds available. This app can send transactions now.`,
        ),
        tone: 'success',
        actions: showDisconnect ? [disconnectAction] : [],
      }

    case 'error': {
      const error = state.error
      const isFundStep = state.step === 'fund'
      return {
        ...base,
        details,
        ...(isFundStep ? { routes: state.fundingRoutes, receive } : {}),
        eyebrow: `Step ${String(stepIndex)} of 3 ${String.fromCharCode(183)} ${steps[stepIndex - 1] ?? ''}`,
        title: titleForError(error?.code),
        detail: error ? `${error.hint} (${error.message})` : 'The last action failed.',
        tone: 'error',
        actions: [
          ...(error?.retryable === false
            ? []
            : [{ id: 'retry', label: label(labels, 'retry', 'Try again'), kind: 'primary' as const }]),
          ...(error?.code === 'no-provider'
            ? [{ id: 'install', label: label(labels, 'installWallet', 'Get a wallet'), kind: 'secondary' as const, href: installUrl }]
            : []),
          ...(state.address && showDisconnect ? [disconnectAction] : []),
          ...(error?.retryable === false && !state.address
            ? [{ id: 'refresh-providers', label: 'Reload wallets', kind: 'secondary' as const }]
            : []),
        ],
      }
    }
  }
}

function titleForError(code: string | undefined): string {
  switch (code) {
    case 'user-rejected':
      return 'Request declined'
    case 'request-pending':
      return 'A prompt is already open'
    case 'chain-not-added':
      return 'Network not in your wallet'
    case 'chain-add-failed':
      return 'Could not add the network'
    case 'unsupported-method':
      return 'Your wallet cannot do this'
    case 'unauthorized':
      return 'Not authorised'
    case 'wallet-disconnected':
      return 'Wallet disconnected'
    case 'balance-read-failed':
      return 'Could not read your balance'
    case 'no-provider':
      return 'No wallet available'
    default:
      return 'Something went wrong'
  }
}
