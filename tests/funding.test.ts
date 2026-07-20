import { describe, expect, it } from 'vitest'
import { hoodMainnet, hoodTestnet } from '../src/core/chains.js'
import { buildFundingRoutes, buildPaymentUri } from '../src/core/funding.js'
import { formatBalance, formatUnits, hexToBigInt, shortenAddress } from '../src/core/format.js'
import { readBalances } from '../src/core/balances.js'
import { FakeProvider } from './helpers/fake-provider.js'

const ACCOUNT = '0x1111111111111111111111111111111111111111'

describe('buildFundingRoutes', () => {
  it('lists the documented mainnet bridges with the canonical route first', () => {
    const routes = buildFundingRoutes(hoodMainnet, ACCOUNT)
    expect(routes.map((route) => route.id)).toEqual(['arbitrum-canonical', 'relay', 'across', 'stargate', 'receive'])
    expect(routes[0]?.url).toContain('portal.arbitrum.io')
  })

  it('always ends with a receive route, on every network and every configuration', () => {
    for (const chain of [hoodMainnet, hoodTestnet]) {
      for (const options of [{}, { disableDefaultBridges: true }, { routes: [] }]) {
        const routes = buildFundingRoutes(chain, ACCOUNT, options)
        expect(routes.length).toBeGreaterThan(0)
        expect(routes.at(-1)?.kind).toBe('receive')
      }
    }
  })

  it('ships no bridge on testnet, because none is documented', () => {
    const routes = buildFundingRoutes(hoodTestnet, ACCOUNT)
    expect(routes).toHaveLength(1)
    expect(routes[0]?.kind).toBe('receive')
    expect(routes[0]?.description).toMatch(/no public bridge/i)
  })

  it('accepts consumer-supplied routes in place of the defaults', () => {
    const routes = buildFundingRoutes(hoodMainnet, ACCOUNT, {
      routes: [{ id: 'custom', label: 'Our bridge', kind: 'bridge', description: 'In-house', url: 'https://example.com', official: false }],
    })
    expect(routes.map((route) => route.id)).toEqual(['custom', 'receive'])
  })

  it('appends extra routes alongside the defaults', () => {
    const routes = buildFundingRoutes(hoodMainnet, ACCOUNT, {
      extraRoutes: [{ id: 'extra', label: 'Extra', kind: 'bridge', description: 'Also this', url: 'https://example.com', official: false }],
    })
    expect(routes.map((route) => route.id)).toContain('extra')
    expect(routes.map((route) => route.id)).toContain('arbitrum-canonical')
  })

  it('drops a consumer receive route rather than showing two', () => {
    const routes = buildFundingRoutes(hoodMainnet, ACCOUNT, {
      extraRoutes: [{ id: 'mine', label: 'Mine', kind: 'receive', description: 'dupe', official: false }],
    })
    expect(routes.filter((route) => route.kind === 'receive')).toHaveLength(1)
  })

  it('carries the address, an EIP-681 URI, and an explorer link on the receive route', () => {
    const receive = buildFundingRoutes(hoodMainnet, ACCOUNT).at(-1)
    expect(receive?.address).toBe(ACCOUNT)
    expect(receive?.uri).toBe(`ethereum:${ACCOUNT}@4663`)
    expect(receive?.explorerUrl).toBe(`https://robinhoodchain.blockscout.com/address/${ACCOUNT}`)
  })

  it('omits the address fields before an account is known', () => {
    const receive = buildFundingRoutes(hoodMainnet, null).at(-1)
    expect(receive?.address).toBeUndefined()
    expect(receive?.uri).toBeUndefined()
  })

  it('points every default bridge at https', () => {
    for (const route of buildFundingRoutes(hoodMainnet, ACCOUNT)) {
      if (route.url) expect(route.url.startsWith('https://')).toBe(true)
    }
  })
})

describe('buildPaymentUri', () => {
  it('pins the chain, which is what keeps a scan off Ethereum mainnet', () => {
    expect(buildPaymentUri(hoodMainnet, ACCOUNT)).toBe(`ethereum:${ACCOUNT}@4663`)
    expect(buildPaymentUri(hoodTestnet, ACCOUNT)).toBe(`ethereum:${ACCOUNT}@46630`)
  })
})

describe('readBalances', () => {
  it('reads native and USDG through a connected provider', async () => {
    const provider = new FakeProvider({
      nativeBalances: { [ACCOUNT.toLowerCase()]: 1_500_000_000_000_000_000n },
      tokenBalances: { [ACCOUNT.toLowerCase()]: 12_345_678n },
    })
    expect(await readBalances({ provider }, hoodMainnet, ACCOUNT)).toEqual({
      native: 1_500_000_000_000_000_000n,
      usdg: 12_345_678n,
    })
  })

  it('calls balanceOf on the right USDG contract for the network', async () => {
    const provider = new FakeProvider()
    await readBalances({ provider }, hoodTestnet, ACCOUNT)
    const call = provider.calls.find((entry) => entry.method === 'eth_call')
    expect((call?.params as [{ to: string; data: string }])[0].to).toBe(hoodTestnet.usdg)
    expect((call?.params as [{ to: string; data: string }])[0].data.startsWith('0x70a08231')).toBe(true)
  })

  it('rejects on an unreadable address rather than reporting zero', async () => {
    await expect(readBalances({ provider: new FakeProvider() }, hoodMainnet, 'nope')).rejects.toMatchObject({
      code: 'balance-read-failed',
    })
  })

  it('rejects when no source is configured', async () => {
    await expect(readBalances({}, hoodMainnet, ACCOUNT)).rejects.toMatchObject({ code: 'balance-read-failed' })
  })

  it('surfaces an RPC failure instead of a false zero', async () => {
    const provider = new FakeProvider().failAlways('eth_getBalance', new Error('node offline'))
    await expect(readBalances({ provider }, hoodMainnet, ACCOUNT)).rejects.toMatchObject({
      code: 'balance-read-failed',
    })
  })
})

describe('formatting', () => {
  it('formats exact decimal values', () => {
    expect(formatUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5')
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001')
    expect(formatUnits(0n, 6)).toBe('0')
    expect(formatUnits(-2_500_000n, 6)).toBe('-2.5')
    expect(formatUnits(1_000_000n, 6)).toBe('1')
  })

  it('truncates for display and never rounds a balance up', () => {
    expect(formatBalance(1_999_999_999_999_999_999n, 18, 4)).toBe('1.9999')
    expect(formatBalance(1_000_000_000_000_000_000n, 18, 4)).toBe('1')
    expect(formatBalance(0n, 18, 4)).toBe('0')
  })

  it('never shows a non-zero balance as zero', () => {
    expect(formatBalance(1n, 18, 4)).toBe('<0.0001')
    expect(formatBalance(1n, 6, 2)).toBe('<0.01')
  })

  it('shortens addresses', () => {
    expect(shortenAddress(ACCOUNT)).toBe('0x1111...1111')
    expect(shortenAddress('0xabc')).toBe('0xabc')
  })

  it('parses hex quantities defensively', () => {
    expect(hexToBigInt('0x10')).toBe(16n)
    expect(hexToBigInt('0x')).toBe(0n)
    expect(hexToBigInt('')).toBe(0n)
    expect(hexToBigInt(null)).toBe(0n)
    expect(hexToBigInt('zzz')).toBe(0n)
    expect(hexToBigInt(5)).toBe(5n)
    expect(hexToBigInt(7n)).toBe(7n)
  })
})
