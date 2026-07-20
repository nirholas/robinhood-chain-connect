import { connect, disconnect, getAccount, getChainId, switchChain } from '@wagmi/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createHoodConfig, hoodConnector, hoodTransports, hoodWagmiChains, robinhoodChain, robinhoodChainTestnet } from '../src/wagmi/index.js'
import { hoodMainnet, hoodTestnet } from '../src/core/chains.js'
import { FakeProvider, announce, resetAnnouncements, rpcError } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'

function visitorWallet(overrides: ConstructorParameters<typeof FakeProvider>[0] = {}): FakeProvider {
  return new FakeProvider({ grantAccounts: [ACCOUNT], chainId: 1, knownChains: [1], ...overrides })
}

afterEach(() => {
  resetAnnouncements()
  window.localStorage.clear()
  delete (window as { ethereum?: unknown }).ethereum
})

describe('chain definitions', () => {
  it('exports both Robinhood Chain networks as a non-empty tuple', () => {
    expect(hoodWagmiChains.map((chain) => chain.id)).toEqual([4663, 46630])
    expect(robinhoodChain.id).toBe(4663)
    expect(robinhoodChainTestnet.id).toBe(46630)
  })

  it('ships a transport for each chain, pointed at the documented RPC', () => {
    expect(Object.keys(hoodTransports).map(Number).sort((a, b) => a - b)).toEqual([4663, 46630])
    expect(typeof hoodTransports[4663]).toBe('function')
  })
})

describe('createHoodConfig', () => {
  it('builds a usable config with the connector wired in', () => {
    const config = createHoodConfig()
    expect(config.chains.map((chain) => chain.id)).toEqual([4663, 46630])
    expect(config.connectors).toHaveLength(1)
    expect(config.connectors[0]?.id).toBe('hood')
  })

  it('narrows to a single network on request', () => {
    expect(createHoodConfig({ networks: ['testnet'] }).chains.map((chain) => chain.id)).toEqual([46630])
  })

  it('refuses an empty network list rather than producing a broken config', () => {
    expect(() => createHoodConfig({ networks: [] })).toThrow(/at least one network/)
  })
})

describe('hoodConnector', () => {
  it('connects and reports the account and chain', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig()

    const result = await connect(config, { connector: config.connectors[0]! })
    expect(result.accounts[0]).toBe(ACCOUNT)
    expect(getAccount(config).address).toBe(ACCOUNT)
    await disconnect(config)
  })

  it('adds Robinhood Chain before switching when the wallet answers 4902', async () => {
    const wallet = visitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig()

    await connect(config, { connector: config.connectors[0]! })
    const chain = await switchChain(config, { chainId: hoodMainnet.id })

    expect(chain.id).toBe(hoodMainnet.id)
    expect(wallet.countOf('wallet_addEthereumChain')).toBe(1)
    const add = wallet.calls.find((call) => call.method === 'wallet_addEthereumChain')
    expect((add?.params as unknown[])[0]).toEqual(hoodMainnet.addChainParameter)
    expect(getChainId(config)).toBe(hoodMainnet.id)
    await disconnect(config)
  })

  it('switches to the testnet with its own parameter object', async () => {
    const wallet = visitorWallet()
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig()

    await connect(config, { connector: config.connectors[0]! })
    await switchChain(config, { chainId: hoodTestnet.id })

    const add = wallet.calls.find((call) => call.method === 'wallet_addEthereumChain')
    expect((add?.params as unknown[])[0]).toEqual(hoodTestnet.addChainParameter)
    await disconnect(config)
  })

  it('does not re-add a network the wallet already knows', async () => {
    const wallet = visitorWallet({ knownChains: [1, hoodMainnet.id] })
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig()

    await connect(config, { connector: config.connectors[0]! })
    await switchChain(config, { chainId: hoodMainnet.id })
    expect(wallet.countOf('wallet_addEthereumChain')).toBe(0)
    await disconnect(config)
  })

  it('surfaces a rejected connect as a normalised error', async () => {
    const wallet = visitorWallet()
    wallet.failNext('eth_requestAccounts', rpcError(4001, 'User rejected the request.'))
    announce(wallet, { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig()

    await expect(connect(config, { connector: config.connectors[0]! })).rejects.toMatchObject({
      code: 'user-rejected',
    })
  })

  it('reports no-provider when nothing is installed', async () => {
    const config = createHoodConfig()
    await expect(connect(config, { connector: config.connectors[0]! })).rejects.toMatchObject({
      code: 'no-provider',
    })
  })

  it('rejects a chain that is not in the wagmi config', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig({ networks: ['mainnet'] })
    await connect(config, { connector: config.connectors[0]! })
    await expect(switchChain(config, { chainId: 46630 as never })).rejects.toBeTruthy()
    await disconnect(config)
  })

  it('targets a specific wallet by rdns', async () => {
    announce(visitorWallet(), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const rabby = visitorWallet({ grantAccounts: ['0x2222222222222222222222222222222222222222'] })
    announce(rabby, { uuid: 'u2', name: 'Rabby', rdns: 'io.rabby' })

    const config = createHoodConfig({ connectors: [hoodConnector({ target: 'io.rabby', id: 'rabby' })] })
    const result = await connect(config, { connector: config.connectors[0]! })
    expect(result.accounts[0]).toBe('0x2222222222222222222222222222222222222222')
    await disconnect(config)
  })

  it('remembers a manual disconnect so reconnect does not undo it', async () => {
    announce(visitorWallet({ accounts: [ACCOUNT] }), { uuid: 'u1', name: 'MetaMask', rdns: 'io.metamask' })
    const config = createHoodConfig()
    const connector = config.connectors[0]!

    await connect(config, { connector })
    expect(await connector.isAuthorized()).toBe(true)

    await disconnect(config)
    expect(await connector.isAuthorized()).toBe(false)
  })
})
