import { resolveHoodChain, type HoodChainId, type HoodNetwork } from '../core/chains.js'
import type { HoodConnectError } from '../core/errors.js'
import { createOnboarding, type Onboarding, type OnboardingConfig, type OnboardingState } from '../core/onboarding.js'
import { generateQr, qrToSvgPath, qrViewBox } from '../ui/qr.js'
import { hoodConnectCss } from '../ui/styles.js'
import { buildView, type OnboardingView, type ViewAction } from '../ui/view.js'

/**
 * `<hood-connect>`: the same three-step onboarding flow as the React
 * component, as a real custom element.
 *
 * It renders into a shadow root, so the host page cannot break its styling and
 * it cannot leak styles into the host page. Configuration is by attribute,
 * state changes are reported as DOM events, and the underlying machine is
 * reachable through the `onboarding` property for anything the attributes do
 * not cover.
 *
 * Importing this module registers the element. It is the one entry point in
 * this package with a side effect, which is why it is a separate subpath.
 *
 * @example
 * ```html
 * <script type="module" src="./hood-connect.element.js"></script>
 * <hood-connect chain="mainnet" theme="auto"></hood-connect>
 * <script type="module">
 *   document.querySelector('hood-connect').addEventListener('hood-connect:ready', (event) => {
 *     console.log('ready', event.detail.address)
 *   })
 * </script>
 * ```
 *
 * @packageDocumentation
 */

/** Event names the element dispatches. All bubble and are composed. */
export const HOOD_CONNECT_EVENTS = {
  /** Every status transition. */
  status: 'hood-connect:status',
  /** The flow reached `ready`. */
  ready: 'hood-connect:ready',
  /** A new error was recorded. */
  error: 'hood-connect:error',
  /** The connected account changed, including to `null` on disconnect. */
  account: 'hood-connect:account',
} as const

/** `detail` payload for `hood-connect:status`, `:ready`, and `:account`. */
export interface HoodConnectEventDetail {
  status: OnboardingState['status']
  step: OnboardingState['step']
  address: string | null
  chainId: number | null
  targetChainId: number
  isFunded: boolean
  state: OnboardingState
}

/** `detail` payload for `hood-connect:error`. */
export interface HoodConnectErrorEventDetail extends HoodConnectEventDetail {
  error: HoodConnectError
  code: HoodConnectError['code']
}

function parseChainAttribute(value: string | null): HoodChainId | HoodNetwork {
  if (!value) return 'mainnet'
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'mainnet' || trimmed === 'testnet') return trimmed
  const numeric = Number.parseInt(trimmed, 10)
  return resolveHoodChain(numeric as HoodChainId).id
}

function parseBooleanAttribute(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '' || trimmed === 'true' || trimmed === '1') return true
  if (trimmed === 'false' || trimmed === '0') return false
  return fallback
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * The `<hood-connect>` element class. Exported so consumers can subclass it or
 * register it under a different tag name.
 */
export class HoodConnectElement extends HTMLElement {
  static readonly observedAttributes = [
    'chain',
    'theme',
    'rpc-url',
    'auto-connect',
    'auto-switch-chain',
    'require-funding',
    'min-native-wei',
    'install-url',
    'show-qr',
    'show-disconnect',
    'unstyled',
  ]

  #onboarding: Onboarding | null = null
  #unsubscribe: (() => void) | null = null
  #root: ShadowRoot
  #card: HTMLDivElement
  #styleNode: HTMLStyleElement
  #rail: HTMLDivElement
  #eyebrow: HTMLParagraphElement
  #title: HTMLHeadingElement
  #detail: HTMLParagraphElement
  #live: HTMLParagraphElement
  #alert: HTMLDivElement
  #wallets: HTMLDivElement
  #details: HTMLDListElement
  #routes: HTMLDivElement
  #receive: HTMLDivElement
  #actions: HTMLDivElement
  #signatures = new Map<string, string>()
  #lastStatus: OnboardingState['status'] | null = null
  #lastError: HoodConnectError | null = null
  #lastAddress: string | null = null
  #qrToken = 0

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open' })

    this.#styleNode = document.createElement('style')
    this.#styleNode.textContent = hoodConnectCss

    this.#card = element('div', 'hc-root')
    this.#card.setAttribute('role', 'region')

    this.#rail = element('div', 'hc-rail')
    this.#rail.setAttribute('role', 'list')
    this.#rail.setAttribute('aria-label', 'Onboarding progress')

    this.#eyebrow = element('p', 'hc-eyebrow')
    this.#title = element('h2', 'hc-title')
    this.#detail = element('p', 'hc-detail')

    this.#live = element('p', 'hc-sr')
    this.#live.setAttribute('role', 'status')
    this.#live.setAttribute('aria-live', 'polite')

    this.#alert = element('div', 'hc-alert')
    this.#alert.setAttribute('role', 'alert')
    this.#alert.hidden = true

    this.#wallets = element('div', 'hc-wallets')
    this.#wallets.setAttribute('role', 'group')
    this.#wallets.setAttribute('aria-label', 'Choose a wallet')

    this.#details = element('dl', 'hc-details')
    this.#routes = element('div', 'hc-routes')
    this.#routes.setAttribute('role', 'group')
    this.#routes.setAttribute('aria-label', 'Ways to add funds')
    this.#receive = element('div', 'hc-receive')
    this.#actions = element('div', 'hc-actions')

    this.#card.append(
      this.#rail,
      this.#eyebrow,
      this.#title,
      this.#detail,
      this.#live,
      this.#alert,
      this.#wallets,
      this.#details,
      this.#routes,
      this.#receive,
      this.#actions,
    )
    this.#root.append(this.#styleNode, this.#card)
  }

  /** The underlying state machine, for anything attributes do not cover. */
  get onboarding(): Onboarding | null {
    return this.#onboarding
  }

  /** The current snapshot, or `null` before the element is connected. */
  get state(): OnboardingState | null {
    return this.#onboarding?.getState() ?? null
  }

  connectedCallback(): void {
    this.#build()
  }

  disconnectedCallback(): void {
    this.#teardown()
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (previous === next || !this.isConnected) return
    // Presentation-only attributes never need the machine rebuilt.
    if (name === 'theme' || name === 'unstyled' || name === 'install-url' || name === 'show-qr' || name === 'show-disconnect') {
      this.#applyPresentation()
      const state = this.#onboarding?.getState()
      if (state) this.#render(state)
      return
    }
    this.#teardown()
    this.#build()
  }

  #config(): OnboardingConfig {
    const rpcUrl = this.getAttribute('rpc-url')
    const minNative = this.getAttribute('min-native-wei')
    return {
      chain: parseChainAttribute(this.getAttribute('chain')),
      autoConnect: parseBooleanAttribute(this.getAttribute('auto-connect'), true),
      autoSwitchChain: parseBooleanAttribute(this.getAttribute('auto-switch-chain'), false),
      requireFunding: parseBooleanAttribute(this.getAttribute('require-funding'), true),
      ...(rpcUrl ? { rpcUrl } : {}),
      ...(minNative ? { minNativeWei: BigInt(minNative) } : {}),
    }
  }

  #build(): void {
    this.#applyPresentation()
    const onboarding = createOnboarding(this.#config())
    this.#onboarding = onboarding
    this.#signatures.clear()
    this.#unsubscribe = onboarding.subscribe((state) => {
      this.#render(state)
      this.#emit(state)
    })
    this.#render(onboarding.getState())
    onboarding.start()
  }

  #teardown(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#onboarding?.destroy()
    this.#onboarding = null
    this.#lastStatus = null
    this.#lastError = null
    this.#lastAddress = null
  }

  #applyPresentation(): void {
    this.#card.dataset['theme'] = this.getAttribute('theme') ?? 'auto'
    this.#styleNode.textContent = this.hasAttribute('unstyled') ? '' : hoodConnectCss
  }

  #emit(state: OnboardingState): void {
    const detail: HoodConnectEventDetail = {
      status: state.status,
      step: state.step,
      address: state.address,
      chainId: state.chainId,
      targetChainId: state.chain.id,
      isFunded: state.isFunded,
      state,
    }
    const dispatch = (type: string, payload: HoodConnectEventDetail | HoodConnectErrorEventDetail): void => {
      this.dispatchEvent(new CustomEvent(type, { detail: payload, bubbles: true, composed: true }))
    }

    if (state.status !== this.#lastStatus) {
      this.#lastStatus = state.status
      dispatch(HOOD_CONNECT_EVENTS.status, detail)
      if (state.status === 'ready') dispatch(HOOD_CONNECT_EVENTS.ready, detail)
    }
    if (state.address !== this.#lastAddress) {
      this.#lastAddress = state.address
      dispatch(HOOD_CONNECT_EVENTS.account, detail)
    }
    if (state.error && state.error !== this.#lastError) {
      this.#lastError = state.error
      dispatch(HOOD_CONNECT_EVENTS.error, { ...detail, error: state.error, code: state.error.code })
    }
    if (!state.error) this.#lastError = null
  }

  #dispatchAction(action: ViewAction): void {
    const onboarding = this.#onboarding
    if (!onboarding) return
    if (action.providerUuid) {
      void onboarding.connect(action.providerUuid)
      return
    }
    switch (action.id) {
      case 'connect':
        void onboarding.connect()
        return
      case 'switch-network':
        void onboarding.switchNetwork()
        return
      case 'add-network':
        void onboarding.addNetwork()
        return
      case 'refresh-balances':
        void onboarding.refreshBalances()
        return
      case 'retry':
        void onboarding.retry()
        return
      case 'disconnect':
        void onboarding.disconnect()
        return
      case 'refresh-providers':
        onboarding.refreshProviders()
        return
      default:
        return
    }
  }

  /**
   * Rebuild a list only when its content actually changed, so a click never
   * destroys the button the user is still focused on.
   */
  #section(key: string, signature: string, container: HTMLElement, build: () => void): boolean {
    if (this.#signatures.get(key) === signature) return false
    this.#signatures.set(key, signature)
    container.replaceChildren()
    build()
    return true
  }

  #render(state: OnboardingState): void {
    const view = buildView(state, {
      ...(this.getAttribute('install-url') ? { installUrl: this.getAttribute('install-url') as string } : {}),
      showDisconnect: parseBooleanAttribute(this.getAttribute('show-disconnect'), true),
    })

    this.#card.dataset['tone'] = view.tone
    this.#card.dataset['status'] = view.status
    this.#card.setAttribute('aria-busy', String(view.busy))
    this.#card.setAttribute('aria-label', `${state.chain.name} wallet onboarding`)

    this.#renderRail(view)

    this.#eyebrow.textContent = view.eyebrow
    this.#title.replaceChildren()
    if (view.busy) {
      const spinner = element('span', 'hc-spinner')
      spinner.setAttribute('aria-hidden', 'true')
      this.#title.append(spinner)
    }
    this.#title.append(document.createTextNode(view.title))
    this.#detail.textContent = view.detail
    this.#live.textContent = `${view.title}. ${view.detail}`

    if (state.error) {
      this.#alert.hidden = false
      this.#alert.replaceChildren(
        element('span', 'hc-alert-code', state.error.code),
        document.createTextNode(` ${state.error.hint}`),
      )
    } else {
      this.#alert.hidden = true
      this.#alert.replaceChildren()
    }

    this.#renderWallets(view)
    this.#renderDetails(view)
    this.#renderRoutes(view)
    this.#renderReceive(view)
    this.#renderActions(view)
  }

  #renderRail(view: OnboardingView): void {
    const signature = `${view.stepIndex}:${view.status === 'ready' ? 'done' : 'live'}:${view.steps.join('|')}`
    this.#section('rail', signature, this.#rail, () => {
      view.steps.forEach((stepLabel, index) => {
        const position = index + 1
        const done = view.status === 'ready' ? true : position < view.stepIndex
        const active = view.status !== 'ready' && position === view.stepIndex
        const item = element('div', 'hc-rail-item')
        item.setAttribute('role', 'listitem')
        item.dataset['state'] = done ? 'done' : active ? 'active' : 'todo'
        if (active) item.setAttribute('aria-current', 'step')
        const bar = element('span', 'hc-rail-bar')
        bar.setAttribute('aria-hidden', 'true')
        item.append(bar, element('span', 'hc-rail-label', stepLabel))
        this.#rail.append(item)
      })
    })
  }

  #renderWallets(view: OnboardingView): void {
    this.#wallets.hidden = view.walletChoices.length === 0
    const signature = view.walletChoices.map((choice) => `${choice.id}:${String(choice.busy)}`).join(',') + String(view.busy)
    this.#section('wallets', signature, this.#wallets, () => {
      for (const choice of view.walletChoices) {
        const button = element('button', 'hc-btn hc-wallet')
        button.type = 'button'
        button.dataset['kind'] = 'secondary'
        button.disabled = view.busy
        button.setAttribute('aria-label', choice.ariaLabel ?? choice.label)
        if (choice.iconUrl) {
          const icon = element('img', 'hc-wallet-icon')
          icon.src = choice.iconUrl
          icon.alt = ''
          button.append(icon)
        } else {
          const placeholder = element('span', 'hc-wallet-icon')
          placeholder.setAttribute('aria-hidden', 'true')
          button.append(placeholder)
        }
        button.append(element('span', 'hc-wallet-name', choice.label))
        if (choice.busy) {
          const spinner = element('span', 'hc-spinner')
          spinner.setAttribute('aria-hidden', 'true')
          button.append(spinner)
        }
        button.addEventListener('click', () => this.#dispatchAction(choice))
        this.#wallets.append(button)
      }
    })
  }

  #renderDetails(view: OnboardingView): void {
    this.#details.hidden = view.details.length === 0
    const signature = view.details.map((detail) => `${detail.label}=${detail.value}`).join('|')
    this.#section('details', signature, this.#details, () => {
      for (const detail of view.details) {
        this.#details.append(element('dt', undefined, detail.label))
        const value = element('dd', detail.mono ? 'hc-mono' : undefined)
        if (detail.href) {
          const link = element('a')
          link.href = detail.href
          link.target = '_blank'
          link.rel = 'noreferrer noopener'
          link.textContent = detail.value
          value.append(link)
        } else {
          value.textContent = detail.value
        }
        this.#details.append(value)
      }
    })
  }

  #renderRoutes(view: OnboardingView): void {
    const bridges = view.routes.filter((route) => route.kind === 'bridge' && route.url)
    this.#routes.hidden = bridges.length === 0
    const signature = bridges.map((route) => route.id).join(',')
    this.#section('routes', signature, this.#routes, () => {
      for (const route of bridges) {
        const link = element('a', 'hc-route')
        link.href = route.url as string
        link.target = '_blank'
        link.rel = 'noreferrer noopener'
        const label = element('span', 'hc-route-label', route.label)
        const arrow = element('span', 'hc-route-arrow', String.fromCharCode(8599))
        arrow.setAttribute('aria-hidden', 'true')
        label.append(arrow)
        link.append(label, element('span', 'hc-route-desc', route.description))
        this.#routes.append(link)
      }
    })
  }

  #renderReceive(view: OnboardingView): void {
    const route = view.receive
    const visible = Boolean(route?.address) && (view.status === 'unfunded' || (view.status === 'error' && view.step === 'fund'))
    this.#receive.hidden = !visible
    if (!visible || !route) {
      this.#signatures.delete('receive')
      this.#receive.replaceChildren()
      return
    }

    const showQr = parseBooleanAttribute(this.getAttribute('show-qr'), true)
    const signature = `${route.address ?? ''}|${String(showQr)}`
    this.#section('receive', signature, this.#receive, () => {
      this.#receive.append(
        element('p', 'hc-receive-head', route.label),
        element('p', 'hc-receive-desc', route.description),
      )
      const body = element('div', 'hc-receive-body')
      const fields = element('div', 'hc-receive-fields')
      fields.append(element('p', 'hc-address', route.address ?? ''))

      const copy = element('button', 'hc-btn hc-copy', 'Copy address')
      copy.type = 'button'
      copy.dataset['kind'] = 'secondary'
      copy.dataset['copied'] = 'false'
      copy.addEventListener('click', () => {
        void this.#copy(route.address ?? '').then((ok) => {
          if (!ok) return
          copy.textContent = 'Copied'
          copy.dataset['copied'] = 'true'
          setTimeout(() => {
            copy.textContent = 'Copy address'
            copy.dataset['copied'] = 'false'
          }, 1800)
        })
      })
      fields.append(copy)
      body.append(fields)
      this.#receive.append(body)

      if (showQr && route.uri) {
        const token = ++this.#qrToken
        void generateQr(route.uri).then((matrix) => {
          if (!matrix || token !== this.#qrToken || !this.isConnected) return
          const holder = element('div', 'hc-qr')
          holder.innerHTML =
            `<svg viewBox="${qrViewBox(matrix)}" role="img" aria-label="QR code for ${route.uri ?? ''}">` +
            `<rect x="-4" y="-4" width="${matrix.size + 8}" height="${matrix.size + 8}" fill="#ffffff"/>` +
            `<path d="${qrToSvgPath(matrix)}" fill="#000000"/></svg>`
          body.prepend(holder)
        })
      }
    })
  }

  #renderActions(view: OnboardingView): void {
    this.#actions.hidden = view.actions.length === 0
    const signature = view.actions.map((action) => `${action.id}:${action.label}`).join(',') + `|${String(view.busy)}`
    this.#section('actions', signature, this.#actions, () => {
      for (const action of view.actions) {
        if (action.href) {
          const link = element('a', 'hc-btn', action.label)
          link.dataset['kind'] = action.kind
          link.href = action.href
          link.target = '_blank'
          link.rel = 'noreferrer noopener'
          this.#actions.append(link)
          continue
        }
        const button = element('button', 'hc-btn', action.label)
        button.type = 'button'
        button.dataset['kind'] = action.kind
        button.disabled = view.busy
        button.setAttribute('aria-label', action.ariaLabel ?? action.label)
        button.addEventListener('click', () => this.#dispatchAction(action))
        this.#actions.append(button)
      }
    })
  }

  async #copy(text: string): Promise<boolean> {
    if (!text) return false
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      // Permission denied. Fall through to the selection-based path.
    }
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
}

/**
 * Register the element. Called automatically when this module is imported,
 * and safe to call again: a name that is already taken is left alone.
 *
 * @param tagName - defaults to `hood-connect`
 * @returns `true` when this call performed the registration
 */
export function defineHoodConnectElement(tagName = 'hood-connect'): boolean {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return false
  if (customElements.get(tagName)) return false
  customElements.define(tagName, tagName === 'hood-connect' ? HoodConnectElement : class extends HoodConnectElement {})
  return true
}

defineHoodConnectElement()
