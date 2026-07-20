import { describe, expect, it, vi } from 'vitest'
import { hoodMainnet, hoodTestnet } from '../src/core/chains.js'
import { HoodConnectError } from '../src/core/errors.js'
import {
  addChain,
  getAccounts,
  getChainId,
  requestAccounts,
  revokePermissions,
  switchChain,
  watchAccounts,
  watchChain,
  watchDisconnect,
} from '../src/core/wallet.js'
import { FakeProvider, rpcError, wrappedRpcError } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'

describe('getAccounts / requestAccounts', () => {
  it('returns already-authorised accounts without prompting', async () => {
    const provider = new FakeProvider({ accounts: [ACCOUNT] })
    expect(await getAccounts(provider)).toEqual([ACCOUNT])
    expect(provider.countOf('eth_requestAccounts')).toBe(0)
  })

  it('returns an empty list rather than throwing when nothing is authorised', async () => {
    expect(await getAccounts(new FakeProvider())).toEqual([])
  })

  it('grants accounts on request', async () => {
    const provider = new FakeProvider({ grantAccounts: [ACCOUNT] })
    expect(await requestAccounts(provider)).toEqual([ACCOUNT])
  })

  it('maps a 4001 rejection to user-rejected', async () => {
    const provider = new FakeProvider().failNext('eth_requestAccounts', rpcError(4001, 'User rejected the request.'))
    await expect(requestAccounts(provider)).rejects.toMatchObject({ code: 'user-rejected', retryable: true })
  })

  it('maps -32002 to request-pending', async () => {
    const provider = new FakeProvider().failNext('eth_requestAccounts', rpcError(-32002, 'Already processing eth_requestAccounts.'))
    await expect(requestAccounts(provider)).rejects.toMatchObject({ code: 'request-pending' })
  })

  it('treats an empty grant as a locked wallet', async () => {
    await expect(requestAccounts(new FakeProvider({ grantAccounts: [] }))).rejects.toMatchObject({
      code: 'wallet-locked',
    })
  })

  it('drops entries that are not addresses', async () => {
    const provider = new FakeProvider({ accounts: [ACCOUNT] })
    provider.accounts = [ACCOUNT, 'not-an-address' as string]
    expect(await getAccounts(provider)).toEqual([ACCOUNT])
  })
})

describe('getChainId', () => {
  it('parses the hex the wallet returns', async () => {
    expect(await getChainId(new FakeProvider({ chainId: 4663 }))).toBe(4663)
  })

  it('throws a readable error on an unusable response', async () => {
    const provider = new FakeProvider()
    vi.spyOn(provider, 'request').mockResolvedValueOnce(undefined)
    await expect(getChainId(provider)).rejects.toBeInstanceOf(HoodConnectError)
  })
})

describe('addChain', () => {
  it('sends the exact parameter object', async () => {
    const provider = new FakeProvider({ chainId: 1 })
    await addChain(provider, hoodMainnet)
    const call = provider.calls.find((entry) => entry.method === 'wallet_addEthereumChain')
    expect((call?.params as unknown[])[0]).toEqual(hoodMainnet.addChainParameter)
    expect(provider.knownChains.has(4663)).toBe(true)
  })

  it('preserves a 4001 rejection rather than reporting a wallet defect', async () => {
    const provider = new FakeProvider().failNext('wallet_addEthereumChain', rpcError(4001, 'User rejected'))
    await expect(addChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'user-rejected' })
  })

  it('reports chain-add-failed for an unclassifiable failure', async () => {
    const provider = new FakeProvider().failNext('wallet_addEthereumChain', new Error('rpc unreachable'))
    await expect(addChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'chain-add-failed' })
  })

  it('surfaces a wallet with no add support as unsupported-method', async () => {
    const provider = new FakeProvider({ supportsAddChain: false })
    await expect(addChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'unsupported-method' })
  })
})

describe('switchChain', () => {
  it('switches directly when the wallet already knows the chain', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1, 4663] })
    await switchChain(provider, hoodMainnet)
    expect(provider.chainId).toBe(4663)
    expect(provider.countOf('wallet_addEthereumChain')).toBe(0)
  })

  it('adds then switches when the wallet answers 4902', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1] })
    await switchChain(provider, hoodMainnet)
    expect(provider.countOf('wallet_addEthereumChain')).toBe(1)
    expect(provider.countOf('wallet_switchEthereumChain')).toBe(2)
    expect(provider.chainId).toBe(4663)
  })

  it('adds then switches when 4902 arrives wrapped in a -32603', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1, 4663] })
    provider.failNext('wallet_switchEthereumChain', wrappedRpcError(4902, 'Unrecognized chain ID'))
    await switchChain(provider, hoodMainnet)
    expect(provider.countOf('wallet_addEthereumChain')).toBe(1)
    expect(provider.chainId).toBe(4663)
  })

  it('works for the testnet too', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1] })
    await switchChain(provider, hoodTestnet)
    expect(provider.chainId).toBe(46630)
  })

  it('propagates a rejected switch without trying to add', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1, 4663] })
    provider.failNext('wallet_switchEthereumChain', rpcError(4001, 'User rejected'))
    await expect(switchChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'user-rejected' })
    expect(provider.countOf('wallet_addEthereumChain')).toBe(0)
  })

  it('propagates a rejected add after a 4902', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1] })
    provider.failNext('wallet_addEthereumChain', rpcError(4001, 'User rejected the add'))
    await expect(switchChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'user-rejected' })
  })

  it('accepts wallets that select the chain during the add and reject the redundant switch', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1] })
    // First switch gives 4902, the add succeeds and selects the chain, and the
    // second switch is refused as pointless. The chain is right, so this passes.
    provider.failNext('wallet_switchEthereumChain', rpcError(4902, 'Unrecognized chain ID'))
    provider.failNext('wallet_switchEthereumChain', rpcError(-32002, 'Already processing'))
    provider.chainId = 4663
    await expect(switchChain(provider, hoodMainnet)).resolves.toBeUndefined()
  })

  it('throws when the second switch fails and the wallet is still elsewhere', async () => {
    const provider = new FakeProvider({ chainId: 1, knownChains: [1] })
    provider.failNext('wallet_switchEthereumChain', rpcError(4902, 'Unrecognized chain ID'))
    provider.failNext('wallet_switchEthereumChain', rpcError(4001, 'User rejected'))
    await expect(switchChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'user-rejected' })
  })

  it('reports unsupported-method for a wallet that cannot switch at all', async () => {
    const provider = new FakeProvider({ supportsSwitchChain: false })
    await expect(switchChain(provider, hoodMainnet)).rejects.toMatchObject({ code: 'unsupported-method' })
  })
})

describe('subscriptions', () => {
  it('delivers account changes and detaches cleanly', () => {
    const provider = new FakeProvider({ accounts: [ACCOUNT] })
    const onChange = vi.fn()
    const unsubscribe = watchAccounts(provider, onChange)
    expect(provider.listenerCount('accountsChanged')).toBe(1)

    provider.setAccounts([])
    expect(onChange).toHaveBeenCalledWith([])

    unsubscribe()
    expect(provider.listenerCount('accountsChanged')).toBe(0)
    provider.setAccounts([ACCOUNT])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('delivers chain changes as numbers', () => {
    const provider = new FakeProvider()
    const onChange = vi.fn()
    const unsubscribe = watchChain(provider, onChange)
    provider.setChain(4663)
    expect(onChange).toHaveBeenCalledWith(4663)
    unsubscribe()
  })

  it('ignores an unparseable chainChanged payload', () => {
    const provider = new FakeProvider()
    const onChange = vi.fn()
    watchChain(provider, onChange)
    provider.emit('chainChanged', null)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('normalises a disconnect payload into a typed error', () => {
    const provider = new FakeProvider()
    const onDisconnect = vi.fn()
    watchDisconnect(provider, onDisconnect)
    provider.emit('disconnect', rpcError(4900, 'Disconnected from all chains'))
    expect(onDisconnect.mock.calls[0]?.[0]).toMatchObject({ code: 'wallet-disconnected' })
  })

  it('returns a no-op unsubscribe for a provider with no event support', () => {
    const provider = new FakeProvider({ supportsEvents: false })
    const unsubscribe = watchAccounts(provider, vi.fn())
    expect(() => unsubscribe()).not.toThrow()
  })

  it('falls back to off() when removeListener is absent', () => {
    const provider = new FakeProvider()
    const off = vi.fn()
    ;(provider as unknown as { removeListener?: unknown }).removeListener = undefined
    ;(provider as unknown as { off: unknown }).off = off
    watchChain(provider, vi.fn())()
    expect(off).toHaveBeenCalled()
  })
})

describe('revokePermissions', () => {
  it('reports success when the wallet supports it', async () => {
    expect(await revokePermissions(new FakeProvider({ accounts: [ACCOUNT] }))).toBe(true)
  })

  it('resolves false rather than throwing on a wallet without it', async () => {
    const provider = new FakeProvider().failAlways('wallet_revokePermissions', rpcError(4200, 'unsupported'))
    expect(await revokePermissions(provider)).toBe(false)
  })
})
