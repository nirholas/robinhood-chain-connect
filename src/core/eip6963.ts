import { isEip1193Provider, type Eip1193Provider, type Eip6963ProviderDetail } from './provider.js'

/**
 * EIP-6963 multi-injected-provider discovery.
 *
 * Before EIP-6963, every wallet fought over the single `window.ethereum` slot
 * and the last one to load won. EIP-6963 replaces that with an announcement
 * protocol: the page dispatches `eip6963:requestProvider`, and each installed
 * wallet answers with an `eip6963:announceProvider` event carrying its own
 * metadata and provider object.
 *
 * Nothing in this module touches `window` at module scope, so importing it in
 * a server bundle is safe. All browser access happens after {@link ProviderStore.start}.
 *
 * @see https://eips.ethereum.org/EIPS/eip-6963
 */

const ANNOUNCE_EVENT = 'eip6963:announceProvider'
const REQUEST_EVENT = 'eip6963:requestProvider'

/** Stable empty snapshot, so SSR renders and hydration compare by reference. */
const EMPTY: readonly Eip6963ProviderDetail[] = Object.freeze([])

/** A reactive list of announced wallets. */
export interface ProviderStore {
  /** Begin listening and emit one discovery request. Idempotent. */
  start(): void
  /** Re-broadcast `eip6963:requestProvider`. Wallets that load late answer it. */
  refresh(): void
  /** Current snapshot. Reference-stable until the list actually changes. */
  getSnapshot(): readonly Eip6963ProviderDetail[]
  /** Snapshot for server rendering: always the same frozen empty array. */
  getServerSnapshot(): readonly Eip6963ProviderDetail[]
  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Look up an announced wallet by its EIP-6963 UUID. */
  getByUuid(uuid: string): Eip6963ProviderDetail | undefined
  /** Look up an announced wallet by its reverse-DNS identifier. */
  getByRdns(rdns: string): Eip6963ProviderDetail | undefined
  /** Stop listening and drop all listeners. Safe to call more than once. */
  destroy(): void
}

/** Options for {@link createProviderStore}. */
export interface ProviderStoreOptions {
  /**
   * Also expose a legacy `window.ethereum` that never announced itself over
   * EIP-6963, so wallets that predate the standard still work.
   * @defaultValue `true`
   */
  includeLegacyWindowEthereum?: boolean
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function'
}

function readLegacyProvider(): Eip1193Provider | null {
  if (!isBrowser()) return null
  const injected = (window as { ethereum?: unknown }).ethereum
  return isEip1193Provider(injected) ? injected : null
}

/**
 * Create an EIP-6963 provider store.
 *
 * @example
 * ```ts
 * import { createProviderStore } from 'hood-connect'
 *
 * const store = createProviderStore()
 * const unsubscribe = store.subscribe(() => {
 *   for (const wallet of store.getSnapshot()) console.log(wallet.info.name)
 * })
 * store.start()
 * // later
 * unsubscribe()
 * store.destroy()
 * ```
 */
export function createProviderStore(options: ProviderStoreOptions = {}): ProviderStore {
  const includeLegacy = options.includeLegacyWindowEthereum ?? true

  /** Announced wallets keyed by UUID, insertion-ordered. */
  const byUuid = new Map<string, Eip6963ProviderDetail>()
  const listeners = new Set<() => void>()
  let snapshot: readonly Eip6963ProviderDetail[] = EMPTY
  let started = false
  let destroyed = false

  function rebuildSnapshot(): void {
    const announced = [...byUuid.values()]
    const legacy = includeLegacy ? readLegacyProvider() : null
    const alreadyAnnounced = legacy !== null && announced.some((detail) => detail.provider === legacy)

    const next: Eip6963ProviderDetail[] = announced
    if (legacy !== null && !alreadyAnnounced) {
      next.push({
        info: {
          uuid: 'legacy-window-ethereum',
          name: legacy.isMetaMask === true ? 'MetaMask' : 'Browser Wallet',
          icon: '',
          rdns: 'legacy.window.ethereum',
        },
        provider: legacy,
      })
    }

    snapshot = next.length === 0 ? EMPTY : Object.freeze(next)
  }

  function emit(): void {
    for (const listener of [...listeners]) listener()
  }

  function onAnnounce(event: Event): void {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail
    if (!detail || typeof detail.info?.uuid !== 'string' || !isEip1193Provider(detail.provider)) return

    const existing = byUuid.get(detail.info.uuid)
    if (existing && existing.provider === detail.provider) return

    byUuid.set(detail.info.uuid, { info: { ...detail.info }, provider: detail.provider })
    rebuildSnapshot()
    emit()
  }

  function requestProviders(): void {
    if (!isBrowser()) return
    window.dispatchEvent(new Event(REQUEST_EVENT))
    // A legacy-only wallet never answers, so fold it in on every request too.
    const before = snapshot
    rebuildSnapshot()
    if (before !== snapshot) emit()
  }

  return {
    start(): void {
      if (started || destroyed || !isBrowser()) return
      started = true
      window.addEventListener(ANNOUNCE_EVENT, onAnnounce)
      requestProviders()
    },
    refresh(): void {
      if (destroyed) return
      requestProviders()
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getByUuid: (uuid: string) => byUuid.get(uuid) ?? snapshot.find((detail) => detail.info.uuid === uuid),
    getByRdns: (rdns: string) => snapshot.find((detail) => detail.info.rdns === rdns),
    destroy(): void {
      if (destroyed) return
      destroyed = true
      if (started && isBrowser()) window.removeEventListener(ANNOUNCE_EVENT, onAnnounce)
      started = false
      listeners.clear()
      byUuid.clear()
      snapshot = EMPTY
    },
  }
}
