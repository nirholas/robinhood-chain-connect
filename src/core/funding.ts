import { explorerAddressUrl, type HoodChainInfo } from './chains.js'

/**
 * Funding routes for the third onboarding step.
 *
 * ## Why routes are data, not a contract call
 *
 * Robinhood Chain is an Arbitrum Orbit chain, so its canonical deposit path is
 * the Arbitrum bridge portal, not a bridge contract this package could call
 * directly. `hood-connect` therefore does not deploy, hardcode, or call any
 * bridge contract: it hands the user a route and gets out of the way. The
 * mainnet URLs below are the ones the chain's own bridging documentation
 * lists (https://docs.robinhood.com/chain/bridging/); every one of them is a
 * first-party or documented-partner destination, not a guess.
 *
 * The `receive` route is always present and always last-resort-proof: any user
 * who can get ETH anywhere can send it to their own address on this chain. The
 * testnet has no documented public bridge, so on testnet the receive route is
 * the only one shipped by default. Supply your own with
 * {@link FundingOptions.routes} rather than expecting one to appear.
 */

/** One way for a user to get funds onto Robinhood Chain. */
export interface FundingRoute {
  /** Stable identifier, unique within a route list. */
  id: string
  /** Button label. */
  label: string
  /**
   * `bridge` opens an external site in a new tab.
   * `receive` shows the user's own address to send funds to.
   */
  kind: 'bridge' | 'receive'
  /** One line explaining what happens if the user picks this. */
  description: string
  /** Destination for a `bridge` route. */
  url?: string
  /** The user's address, for a `receive` route. */
  address?: string
  /**
   * EIP-681 payment URI for the `receive` route. Mobile wallets and QR
   * scanners resolve it to a prefilled send screen on the right chain.
   */
  uri?: string
  /** Block-explorer link for the receiving address. */
  explorerUrl?: string
  /** True when the route comes from the chain's own documentation. */
  official: boolean
}

/** Options for {@link buildFundingRoutes}. */
export interface FundingOptions {
  /**
   * Replace the default bridge routes entirely. The `receive` route is always
   * appended regardless, because it is the only route that cannot break.
   */
  routes?: FundingRoute[]
  /**
   * Append to the default bridge routes instead of replacing them.
   */
  extraRoutes?: FundingRoute[]
  /** Drop the built-in bridge routes and keep only `receive` plus any extras. */
  disableDefaultBridges?: boolean
}

/**
 * Bridge routes documented at https://docs.robinhood.com/chain/bridging/ as of
 * 2026-07-20. The canonical Arbitrum portal is listed first because it is the
 * trust-minimised path: it inherits Ethereum security and needs no third-party
 * validator set.
 */
const MAINNET_BRIDGE_ROUTES: readonly FundingRoute[] = Object.freeze([
  Object.freeze({
    id: 'arbitrum-canonical',
    label: 'Bridge from Ethereum',
    kind: 'bridge',
    description: 'Canonical Arbitrum bridge. Trust-minimised, around 10 minutes to deposit.',
    url: 'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum',
    official: true,
  }),
  Object.freeze({
    id: 'relay',
    label: 'Bridge with Relay',
    kind: 'bridge',
    description: 'Fast third-party route from most chains. Seconds, for a small fee.',
    url: 'https://relay.link/bridge/robinhood',
    official: true,
  }),
  Object.freeze({
    id: 'across',
    label: 'Bridge with Across',
    kind: 'bridge',
    description: 'Intent-based bridge from most EVM chains.',
    url: 'https://across.to/?to=robinhood',
    official: true,
  }),
  Object.freeze({
    id: 'stargate',
    label: 'Bridge with Stargate',
    kind: 'bridge',
    description: 'LayerZero omnichain route, useful for stablecoin deposits.',
    url: 'https://stargate.finance',
    official: true,
  }),
]) as readonly FundingRoute[]

/**
 * Build the funding routes to show a user.
 *
 * The `receive` route is always included and always last, so there is never a
 * funding step with zero options, on any network, with any configuration.
 *
 * @example
 * ```ts
 * import { buildFundingRoutes, hoodMainnet } from 'hood-connect'
 *
 * const routes = buildFundingRoutes(hoodMainnet, '0x0000000000000000000000000000000000000001')
 * console.log(routes.map((route) => route.id))
 * // ['arbitrum-canonical', 'relay', 'across', 'stargate', 'receive']
 * ```
 */
export function buildFundingRoutes(
  chain: HoodChainInfo,
  address: string | null,
  options: FundingOptions = {},
): FundingRoute[] {
  const bridges: FundingRoute[] = options.routes
    ? [...options.routes]
    : options.disableDefaultBridges || chain.isTestnet
      ? []
      : [...MAINNET_BRIDGE_ROUTES]

  if (options.extraRoutes) bridges.push(...options.extraRoutes)

  const receive: FundingRoute = {
    id: 'receive',
    label: 'Receive to this address',
    kind: 'receive',
    description: chain.isTestnet
      ? `Send testnet ETH to your address on ${chain.name}. There is no public bridge for this network.`
      : `Send ETH to your address on ${chain.name} from an exchange or another wallet.`,
    official: true,
    ...(address
      ? {
          address,
          uri: buildPaymentUri(chain, address),
          explorerUrl: explorerAddressUrl(chain, address),
        }
      : {}),
  }

  return [...bridges.filter((route) => route.kind !== 'receive'), receive]
}

/**
 * Build an EIP-681 payment URI for an address on a specific chain.
 *
 * The `@chainId` suffix is what makes a scanned QR land on Robinhood Chain
 * rather than on Ethereum mainnet, which is the single most common way a
 * "receive" flow loses someone's funds to the wrong network.
 *
 * @see https://eips.ethereum.org/EIPS/eip-681
 */
export function buildPaymentUri(chain: HoodChainInfo, address: string): string {
  return `ethereum:${address}@${chain.id}`
}
