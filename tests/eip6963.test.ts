import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderStore } from '../src/core/eip6963.js'
import { FakeProvider, announce, resetAnnouncements } from './helpers/fake-provider.js'

describe('createProviderStore', () => {
  beforeEach(() => {
    delete (window as { ethereum?: unknown }).ethereum
  })

  afterEach(() => {
    resetAnnouncements()
    delete (window as { ethereum?: unknown }).ethereum
  })

  it('starts empty and returns a stable snapshot before start()', () => {
    const store = createProviderStore()
    expect(store.getSnapshot()).toEqual([])
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    store.destroy()
  })

  it('returns a reference-stable server snapshot, which SSR hydration requires', () => {
    const store = createProviderStore()
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot())
    store.destroy()
  })

  it('collects wallets that answer the discovery request', () => {
    const store = createProviderStore()
    const metamask = new FakeProvider()
    const rabby = new FakeProvider()
    announce(metamask, { uuid: 'uuid-mm', name: 'MetaMask', rdns: 'io.metamask' })
    announce(rabby, { uuid: 'uuid-rabby', name: 'Rabby', rdns: 'io.rabby' })

    store.start()

    expect(store.getSnapshot().map((detail) => detail.info.name)).toEqual(['MetaMask', 'Rabby'])
    expect(store.getByRdns('io.rabby')?.provider).toBe(rabby)
    expect(store.getByUuid('uuid-mm')?.provider).toBe(metamask)
    store.destroy()
  })

  it('notifies subscribers when a wallet announces late', () => {
    const store = createProviderStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.start()
    expect(store.getSnapshot()).toHaveLength(0)

    announce(new FakeProvider(), { uuid: 'late', name: 'Late Wallet', rdns: 'com.late' })

    expect(listener).toHaveBeenCalled()
    expect(store.getSnapshot()).toHaveLength(1)
    store.destroy()
  })

  it('deduplicates repeated announcements of the same wallet', () => {
    const store = createProviderStore()
    const provider = new FakeProvider()
    store.start()
    announce(provider, { uuid: 'same', name: 'Wallet', rdns: 'com.wallet' })
    announce(provider, { uuid: 'same', name: 'Wallet', rdns: 'com.wallet' })
    store.refresh()
    expect(store.getSnapshot()).toHaveLength(1)
    store.destroy()
  })

  it('folds in a legacy window.ethereum that never announces', () => {
    const legacy = new FakeProvider()
    ;(legacy as FakeProvider & { isMetaMask: boolean }).isMetaMask = true
    ;(window as { ethereum?: unknown }).ethereum = legacy

    const store = createProviderStore()
    store.start()

    const snapshot = store.getSnapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]?.info.name).toBe('MetaMask')
    expect(snapshot[0]?.info.rdns).toBe('legacy.window.ethereum')
    store.destroy()
  })

  it('does not list a wallet twice when it both announces and sets window.ethereum', () => {
    const provider = new FakeProvider()
    ;(window as { ethereum?: unknown }).ethereum = provider
    const store = createProviderStore()
    announce(provider, { uuid: 'dual', name: 'Dual Wallet', rdns: 'com.dual' })
    store.start()

    expect(store.getSnapshot()).toHaveLength(1)
    expect(store.getSnapshot()[0]?.info.rdns).toBe('com.dual')
    store.destroy()
  })

  it('honours includeLegacyWindowEthereum: false', () => {
    ;(window as { ethereum?: unknown }).ethereum = new FakeProvider()
    const store = createProviderStore({ includeLegacyWindowEthereum: false })
    store.start()
    expect(store.getSnapshot()).toHaveLength(0)
    store.destroy()
  })

  it('ignores malformed announcements instead of crashing', () => {
    const store = createProviderStore()
    store.start()
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: {}, provider: {} } }))
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: null }))
    expect(store.getSnapshot()).toHaveLength(0)
    store.destroy()
  })

  it('is idempotent on start and safe to destroy twice', () => {
    const store = createProviderStore()
    store.start()
    store.start()
    announce(new FakeProvider(), { uuid: 'a', name: 'A', rdns: 'com.a' })
    expect(store.getSnapshot()).toHaveLength(1)
    store.destroy()
    store.destroy()
    expect(store.getSnapshot()).toHaveLength(0)
  })

  it('stops listening after destroy', () => {
    const store = createProviderStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.start()
    store.destroy()
    listener.mockClear()
    announce(new FakeProvider(), { uuid: 'after', name: 'After', rdns: 'com.after' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('removes a subscriber when its unsubscribe runs', () => {
    const store = createProviderStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.start()
    unsubscribe()
    announce(new FakeProvider(), { uuid: 'x', name: 'X', rdns: 'com.x' })
    expect(listener).not.toHaveBeenCalled()
    store.destroy()
  })
})
