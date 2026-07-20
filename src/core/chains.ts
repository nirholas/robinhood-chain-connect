/**
 * Robinhood Chain network constants and the exact `wallet_addEthereumChain`
 * parameter objects.
 *
 * These objects are the load-bearing part of this package. A wrong `chainId`
 * hex string, a symbol longer than six characters, or an explorer URL with a
 * trailing slash is enough for MetaMask to reject the request, and every
 * consumer inherits that break. Every field below is derived from viem's
 * official `robinhood` / `robinhoodTestnet` chain definitions, which is the
 * same source `viem`, `wagmi`, and the chain's own docs agree on.
 */

/** Robinhood Chain mainnet. */
export const HOOD_MAINNET_ID = 4663 as const
/** Robinhood Chain testnet. */
export const HOOD_TESTNET_ID = 46630 as const

/** The two chain IDs this package supports. */
export type HoodChainId = typeof HOOD_MAINNET_ID | typeof HOOD_TESTNET_ID

/** Friendly aliases accepted anywhere a chain is configured. */
export type HoodNetwork = 'mainnet' | 'testnet'

/**
 * The `wallet_addEthereumChain` parameter object, per EIP-3085.
 *
 * @see https://eips.ethereum.org/EIPS/eip-3085
 */
export interface AddEthereumChainParameter {
  /** Chain ID as a `0x`-prefixed, unpadded hex string. */
  chainId: `0x${string}`
  chainName: string
  nativeCurrency: { name: string; symbol: string; decimals: 18 }
  rpcUrls: string[]
  blockExplorerUrls: string[]
}

/** Everything `hood-connect` knows about one Robinhood Chain network. */
export interface HoodChainInfo {
  id: HoodChainId
  network: HoodNetwork
  name: string
  /** Chain ID as unpadded hex, the form every wallet RPC expects. */
  hexChainId: `0x${string}`
  isTestnet: boolean
  rpcUrl: string
  explorerUrl: string
  /** USDG (Global Dollar), 6 decimals, the chain's canonical stablecoin. */
  usdg: `0x${string}`
  usdgDecimals: 6
  /** The exact object to hand to `wallet_addEthereumChain`. */
  addChainParameter: AddEthereumChainParameter
}

/**
 * Convert a chain ID to the unpadded lowercase hex string wallets expect.
 * MetaMask rejects zero-padded values such as `0x01237`.
 */
export function toHexChainId(chainId: number): `0x${string}` {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new RangeError(`Invalid chain ID: ${String(chainId)}. Expected a positive integer.`)
  }
  return `0x${chainId.toString(16)}`
}

/** Parse an `eth_chainId` result (hex string or number) into a number. */
export function parseChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value) {
    const parsed = value.startsWith('0x') || value.startsWith('0X') ? Number.parseInt(value, 16) : Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/** Robinhood Chain mainnet (4663). */
export const hoodMainnet: HoodChainInfo = Object.freeze({
  id: HOOD_MAINNET_ID,
  network: 'mainnet',
  name: 'Robinhood Chain',
  hexChainId: '0x1237',
  isTestnet: false,
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  usdgDecimals: 6,
  addChainParameter: Object.freeze({
    chainId: '0x1237',
    chainName: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
  }) as AddEthereumChainParameter,
})

/** Robinhood Chain testnet (46630). */
export const hoodTestnet: HoodChainInfo = Object.freeze({
  id: HOOD_TESTNET_ID,
  network: 'testnet',
  name: 'Robinhood Chain Testnet',
  hexChainId: '0xb626',
  isTestnet: true,
  rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
  explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
  usdg: '0x7E955252E15c84f5768B83c41a71F9eba181802F',
  usdgDecimals: 6,
  addChainParameter: Object.freeze({
    chainId: '0xb626',
    chainName: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
  }) as AddEthereumChainParameter,
})

/** Both supported networks, mainnet first. */
export const hoodChains: readonly HoodChainInfo[] = Object.freeze([hoodMainnet, hoodTestnet])

/**
 * Resolve a chain ID or network alias to its {@link HoodChainInfo}.
 *
 * @throws RangeError when the value is not a Robinhood Chain network.
 *
 * @example
 * ```ts
 * import { resolveHoodChain } from 'hood-connect'
 *
 * resolveHoodChain('testnet').id      // 46630
 * resolveHoodChain(4663).hexChainId   // '0x1237'
 * ```
 */
export function resolveHoodChain(target: HoodChainId | HoodNetwork): HoodChainInfo {
  if (target === 'mainnet' || target === HOOD_MAINNET_ID) return hoodMainnet
  if (target === 'testnet' || target === HOOD_TESTNET_ID) return hoodTestnet
  throw new RangeError(
    `Unsupported network "${String(target)}". Use 4663 / 'mainnet' or 46630 / 'testnet'.`,
  )
}

/** Build a block-explorer URL for an address on the given network. */
export function explorerAddressUrl(chain: HoodChainInfo, address: string): string {
  return `${chain.explorerUrl}/address/${address}`
}
