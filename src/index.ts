/**
 * `hood-connect` is the wallet and onboarding kit for Robinhood Chain dApps.
 *
 * A first-time visitor to a Robinhood Chain dApp almost always has a wallet,
 * almost never has the network added, and has a zero balance on it. This
 * package models that as one state machine and ships the UI for it: EIP-6963
 * discovery, connect, add-then-switch the network with the exact EIP-3085
 * parameters for chain 4663 and 46630, and a funding step with the chain's
 * documented bridge routes plus a receive-to-address fallback.
 *
 * Subpath exports:
 * - `hood-connect/react` for the hooks and the `<HoodConnect />` component
 * - `hood-connect/wagmi` for the chain definitions and the wagmi connector
 * - `hood-connect/element` for the `<hood-connect>` custom element
 *
 * @packageDocumentation
 */

export {
  HOOD_MAINNET_ID,
  HOOD_TESTNET_ID,
  explorerAddressUrl,
  hoodChains,
  hoodMainnet,
  hoodTestnet,
  parseChainId,
  resolveHoodChain,
  toHexChainId,
  type AddEthereumChainParameter,
  type HoodChainId,
  type HoodChainInfo,
  type HoodNetwork,
} from './core/chains.js'

export {
  HoodConnectError,
  extractProviderCode,
  toHoodConnectError,
  type HoodConnectErrorCode,
} from './core/errors.js'

export { createProviderStore, type ProviderStore, type ProviderStoreOptions } from './core/eip6963.js'

export {
  isEip1193Provider,
  type Eip1193Event,
  type Eip1193Provider,
  type Eip1193RequestArguments,
  type Eip6963ProviderDetail,
  type Eip6963ProviderInfo,
  type ProviderRpcErrorLike,
} from './core/provider.js'

export {
  addChain,
  getAccounts,
  getChainId,
  requestAccounts,
  revokePermissions,
  switchChain,
  watchAccounts,
  watchChain,
  watchDisconnect,
  type AccountAddress,
} from './core/wallet.js'

export { readBalances, type BalanceSource, type HoodBalances } from './core/balances.js'

export {
  buildFundingRoutes,
  buildPaymentUri,
  type FundingOptions,
  type FundingRoute,
} from './core/funding.js'

export {
  createOnboarding,
  deriveStatus,
  stepForStatus,
  type Onboarding,
  type OnboardingConfig,
  type OnboardingState,
  type OnboardingStatus,
  type OnboardingStep,
  type OnboardingStorage,
  type PendingAction,
} from './core/onboarding.js'

export { formatBalance, formatUnits, hexToBigInt, shortenAddress } from './core/format.js'

export {
  buildView,
  type BuildViewOptions,
  type OnboardingView,
  type ViewAction,
  type ViewDetail,
  type ViewLabels,
} from './ui/view.js'

export { hoodConnectCss } from './ui/styles.js'

export { generateQr, qrToSvgPath, qrViewBox, type QrMatrix } from './ui/qr.js'
