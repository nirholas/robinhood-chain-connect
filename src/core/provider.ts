/**
 * Minimal EIP-1193 provider surface, declared locally so `hood-connect` never
 * depends on a wallet library to describe the object a wallet injects.
 *
 * @see https://eips.ethereum.org/EIPS/eip-1193
 */

/** A JSON-RPC request as EIP-1193 defines it. */
export interface Eip1193RequestArguments {
  readonly method: string
  readonly params?: readonly unknown[] | object
}

/** Events an EIP-1193 provider emits. */
export type Eip1193Event = 'accountsChanged' | 'chainChanged' | 'connect' | 'disconnect' | 'message'

/** The subset of EIP-1193 that `hood-connect` uses. */
export interface Eip1193Provider {
  request(args: Eip1193RequestArguments): Promise<unknown>
  on?(event: Eip1193Event, listener: (payload: never) => void): void
  removeListener?(event: Eip1193Event, listener: (payload: never) => void): void
  /** Some providers only ship the `off` alias. */
  off?(event: Eip1193Event, listener: (payload: never) => void): void
  /** Legacy MetaMask marker, used only for display ordering. */
  isMetaMask?: boolean
}

/** The error shape EIP-1193 providers reject with. */
export interface ProviderRpcErrorLike {
  code?: number | string
  message?: string
  data?: unknown
}

/**
 * EIP-6963 provider metadata.
 *
 * @see https://eips.ethereum.org/EIPS/eip-6963
 */
export interface Eip6963ProviderInfo {
  /** Stable per-page UUIDv4 assigned by the wallet. */
  uuid: string
  /** Human-readable wallet name. */
  name: string
  /** A data URI for the wallet icon. */
  icon: string
  /** Reverse-DNS wallet identifier, e.g. `io.metamask`. */
  rdns: string
}

/** An announced wallet: its metadata plus its provider object. */
export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo
  provider: Eip1193Provider
}

/** Narrow an unknown value to something that can service EIP-1193 requests. */
export function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return typeof value === 'object' && value !== null && typeof (value as Eip1193Provider).request === 'function'
}
