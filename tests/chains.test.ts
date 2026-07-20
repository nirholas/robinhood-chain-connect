import { describe, expect, it } from 'vitest'
import { robinhood, robinhoodTestnet } from 'viem/chains'
import {
  HOOD_MAINNET_ID,
  HOOD_TESTNET_ID,
  explorerAddressUrl,
  hoodChains,
  hoodMainnet,
  hoodTestnet,
  parseChainId,
  resolveHoodChain,
  toHexChainId,
} from '../src/core/chains.js'

/**
 * The `wallet_addEthereumChain` parameter objects are snapshotted literally.
 * If a future edit changes so much as a trailing slash, this test fails, which
 * is the point: a wrong parameter object is a broken onboarding for every
 * consumer of this package and it fails silently in the wallet, not here.
 */
describe('addEthereumChain parameters', () => {
  it('matches the exact mainnet object', () => {
    expect(hoodMainnet.addChainParameter).toEqual({
      chainId: '0x1237',
      chainName: 'Robinhood Chain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
      blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
    })
  })

  it('matches the exact testnet object', () => {
    expect(hoodTestnet.addChainParameter).toEqual({
      chainId: '0xb626',
      chainName: 'Robinhood Chain Testnet',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
      blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
    })
  })

  it('encodes the chain IDs the wallet will compare against', () => {
    expect(Number.parseInt(hoodMainnet.addChainParameter.chainId, 16)).toBe(4663)
    expect(Number.parseInt(hoodTestnet.addChainParameter.chainId, 16)).toBe(46630)
  })

  it('uses unpadded lowercase hex, which MetaMask requires', () => {
    for (const chain of hoodChains) {
      expect(chain.hexChainId).toMatch(/^0x[0-9a-f]+$/)
      expect(chain.hexChainId).not.toMatch(/^0x0/)
      expect(chain.hexChainId).toBe(chain.addChainParameter.chainId)
    }
  })

  it('keeps the currency symbol inside the 2 to 6 character window wallets enforce', () => {
    for (const chain of hoodChains) {
      const { symbol } = chain.addChainParameter.nativeCurrency
      expect(symbol.length).toBeGreaterThanOrEqual(2)
      expect(symbol.length).toBeLessThanOrEqual(6)
      expect(chain.addChainParameter.nativeCurrency.decimals).toBe(18)
    }
  })

  it('ships https URLs with no trailing slash', () => {
    for (const chain of hoodChains) {
      for (const url of [...chain.addChainParameter.rpcUrls, ...chain.addChainParameter.blockExplorerUrls]) {
        expect(url.startsWith('https://')).toBe(true)
        expect(url.endsWith('/')).toBe(false)
      }
    }
  })

  it('agrees with viem, the definition wallets and wagmi already share', () => {
    expect(hoodMainnet.id).toBe(robinhood.id)
    expect(hoodMainnet.rpcUrl).toBe(robinhood.rpcUrls.default.http[0])
    expect(hoodMainnet.explorerUrl).toBe(robinhood.blockExplorers?.default.url)
    expect(hoodMainnet.addChainParameter.nativeCurrency.symbol).toBe(robinhood.nativeCurrency.symbol)

    expect(hoodTestnet.id).toBe(robinhoodTestnet.id)
    expect(hoodTestnet.rpcUrl).toBe(robinhoodTestnet.rpcUrls.default.http[0])
    expect(hoodTestnet.explorerUrl).toBe(robinhoodTestnet.blockExplorers?.default.url)
    expect(hoodTestnet.addChainParameter.nativeCurrency.name).toBe(robinhoodTestnet.nativeCurrency.name)
  })

  it('freezes the parameter objects so a consumer cannot mutate them', () => {
    expect(Object.isFrozen(hoodMainnet.addChainParameter)).toBe(true)
    expect(Object.isFrozen(hoodTestnet)).toBe(true)
  })
})

describe('toHexChainId', () => {
  it('converts both supported chains', () => {
    expect(toHexChainId(HOOD_MAINNET_ID)).toBe('0x1237')
    expect(toHexChainId(HOOD_TESTNET_ID)).toBe('0xb626')
  })

  it('rejects values that are not positive integers', () => {
    expect(() => toHexChainId(0)).toThrow(RangeError)
    expect(() => toHexChainId(-1)).toThrow(RangeError)
    expect(() => toHexChainId(1.5)).toThrow(RangeError)
  })
})

describe('parseChainId', () => {
  it('reads every shape a wallet returns', () => {
    expect(parseChainId('0x1237')).toBe(4663)
    expect(parseChainId('0X1237')).toBe(4663)
    expect(parseChainId('4663')).toBe(4663)
    expect(parseChainId(4663)).toBe(4663)
    expect(parseChainId(4663n)).toBe(4663)
  })

  it('returns null for unusable values instead of guessing', () => {
    expect(parseChainId(null)).toBeNull()
    expect(parseChainId(undefined)).toBeNull()
    expect(parseChainId('')).toBeNull()
    expect(parseChainId('not-a-chain')).toBeNull()
    expect(parseChainId({})).toBeNull()
  })
})

describe('resolveHoodChain', () => {
  it('accepts both IDs and both aliases', () => {
    expect(resolveHoodChain('mainnet')).toBe(hoodMainnet)
    expect(resolveHoodChain(4663)).toBe(hoodMainnet)
    expect(resolveHoodChain('testnet')).toBe(hoodTestnet)
    expect(resolveHoodChain(46630)).toBe(hoodTestnet)
  })

  it('throws with an actionable message for anything else', () => {
    expect(() => resolveHoodChain(1 as never)).toThrow(/4663.*46630/s)
  })
})

describe('explorerAddressUrl', () => {
  it('builds a Blockscout address link', () => {
    expect(explorerAddressUrl(hoodMainnet, '0xabc')).toBe('https://robinhoodchain.blockscout.com/address/0xabc')
  })
})
