import type { ProviderRpcErrorLike } from './provider.js'

/**
 * Every failure `hood-connect` surfaces is normalised into one of these codes,
 * so a UI can branch on a small closed set instead of on wallet-specific
 * numeric codes and message strings.
 */
export type HoodConnectErrorCode =
  /** No injected provider was found on the page. */
  | 'no-provider'
  /** The user dismissed or rejected the wallet prompt (EIP-1193 4001). */
  | 'user-rejected'
  /** A prompt for this request is already open (MetaMask -32002). */
  | 'request-pending'
  /** The wallet does not know this chain yet (MetaMask 4902). */
  | 'chain-not-added'
  /** The wallet refused to add the network. */
  | 'chain-add-failed'
  /** The provider does not implement the RPC method (EIP-1193 4200 / -32601). */
  | 'unsupported-method'
  /** The dApp is not authorised for this account (EIP-1193 4100). */
  | 'unauthorized'
  /** The provider is disconnected from all chains (EIP-1193 4900 / 4901). */
  | 'wallet-disconnected'
  /** The wallet is installed but returned no accounts: it is locked. */
  | 'wallet-locked'
  /** A balance read failed. */
  | 'balance-read-failed'
  /** Anything not otherwise classified. */
  | 'unknown'

/** Human-readable recovery hint per error code. Shown verbatim in the UI. */
const HINTS: Record<HoodConnectErrorCode, string> = {
  'no-provider': 'Install a browser wallet, then reload this page.',
  'user-rejected': 'You dismissed the wallet prompt. Try again when you are ready.',
  'request-pending': 'A wallet prompt is already open. Finish it in your wallet, then retry.',
  'chain-not-added': 'Robinhood Chain is not in your wallet yet. Add it to continue.',
  'chain-add-failed': 'Your wallet declined to add Robinhood Chain. Add it manually from the network settings.',
  'unsupported-method': 'This wallet cannot add or switch networks from a website. Switch to Robinhood Chain manually.',
  unauthorized: 'This site is not authorised to see your accounts. Reconnect from your wallet.',
  'wallet-disconnected': 'Your wallet lost its connection to the chain. Reopen the wallet, then retry.',
  'wallet-locked': 'Your wallet is locked. Unlock it, then retry.',
  'balance-read-failed': 'Could not read your balance. Check your network connection and retry.',
  unknown: 'Something went wrong. Retry, or reload the page if it persists.',
}

/** Codes the user can recover from by retrying the same action. */
const RETRYABLE: ReadonlySet<HoodConnectErrorCode> = new Set<HoodConnectErrorCode>([
  'user-rejected',
  'request-pending',
  'chain-not-added',
  'chain-add-failed',
  'wallet-locked',
  'wallet-disconnected',
  'balance-read-failed',
  'unknown',
])

/**
 * The single error type thrown and surfaced by `hood-connect`.
 *
 * @example
 * ```ts
 * import { HoodConnectError } from 'hood-connect'
 *
 * try {
 *   await onboarding.connect()
 * } catch (error) {
 *   if (error instanceof HoodConnectError && error.code === 'user-rejected') {
 *     // benign: the user closed the prompt
 *   }
 * }
 * ```
 */
export class HoodConnectError extends Error {
  override name = 'HoodConnectError'
  /** Normalised classification of the failure. */
  readonly code: HoodConnectErrorCode
  /** A recovery instruction safe to render directly to a user. */
  readonly hint: string
  /** Whether retrying the same action can plausibly succeed. */
  readonly retryable: boolean
  /** The original provider error code, when there was one. */
  readonly providerCode: number | string | undefined

  constructor(
    code: HoodConnectErrorCode,
    message: string,
    options: { cause?: unknown; providerCode?: number | string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    this.hint = HINTS[code]
    this.retryable = RETRYABLE.has(code)
    this.providerCode = options.providerCode
  }
}

/**
 * Walk an unknown rejection value looking for an EIP-1193 numeric code.
 *
 * Wallets are inconsistent here. MetaMask rejects with `{ code: 4902 }`, but
 * several wallets wrap the same condition in a generic `-32603` internal error
 * carrying the real code at `data.originalError.code` or `data.code`. Both
 * shapes have to be understood or "network not added" is misread as "unknown"
 * and the add-then-switch fallback never fires.
 */
export function extractProviderCode(error: unknown, depth = 0): number | string | undefined {
  if (depth > 4 || typeof error !== 'object' || error === null) return undefined
  const candidate = error as ProviderRpcErrorLike & { data?: { originalError?: unknown } }

  const nestedFromOriginal = extractProviderCode(candidate.data?.originalError, depth + 1)
  if (nestedFromOriginal !== undefined) return nestedFromOriginal

  const nestedFromData = extractProviderCode(candidate.data, depth + 1)
  if (nestedFromData !== undefined) return nestedFromData

  const nestedFromCause = extractProviderCode((candidate as { cause?: unknown }).cause, depth + 1)
  if (nestedFromCause !== undefined) return nestedFromCause

  if (typeof candidate.code === 'number' || typeof candidate.code === 'string') {
    // -32603 is "internal error": a container, never the real classification.
    if (candidate.code === -32603) return undefined
    return candidate.code
  }
  return undefined
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as ProviderRpcErrorLike).message
    if (typeof message === 'string' && message) return message
  }
  if (typeof error === 'string' && error) return error
  return 'The wallet request failed.'
}

/**
 * Normalise any thrown value from a wallet into a {@link HoodConnectError}.
 *
 * Already-normalised errors pass through unchanged so a rethrow never loses
 * its classification.
 */
export function toHoodConnectError(error: unknown, fallback: HoodConnectErrorCode = 'unknown'): HoodConnectError {
  if (error instanceof HoodConnectError) return error

  const providerCode = extractProviderCode(error)
  const message = messageOf(error)
  const code = classify(providerCode, message, fallback)

  return new HoodConnectError(
    code,
    message,
    providerCode === undefined ? { cause: error } : { cause: error, providerCode },
  )
}

function classify(providerCode: number | string | undefined, message: string, fallback: HoodConnectErrorCode): HoodConnectErrorCode {
  switch (providerCode) {
    case 4001:
      return 'user-rejected'
    case 4100:
      return 'unauthorized'
    case 4200:
    case -32601:
      return 'unsupported-method'
    case 4900:
    case 4901:
      return 'wallet-disconnected'
    case 4902:
      return 'chain-not-added'
    case -32002:
      return 'request-pending'
    default:
      break
  }

  // Some wallets only signal rejection in prose. Match conservatively: these
  // phrases are stable across MetaMask, Rabby, Coinbase Wallet, and OKX.
  const lower = message.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('user cancel')) {
    return 'user-rejected'
  }
  if (lower.includes('already pending') || lower.includes('already processing')) {
    return 'request-pending'
  }
  if (lower.includes('unrecognized chain') || lower.includes('unrecognised chain')) {
    return 'chain-not-added'
  }
  return fallback
}
