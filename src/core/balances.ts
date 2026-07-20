import type { HoodChainInfo } from './chains.js'
import { HoodConnectError, toHoodConnectError } from './errors.js'
import { hexToBigInt } from './format.js'
import type { Eip1193Provider } from './provider.js'

/**
 * Native and USDG balance reads.
 *
 * Reads go through plain `eth_getBalance` / `eth_call` so the funding step
 * needs no client library at runtime. `balanceOf(address)` is a fixed
 * four-byte selector plus one left-padded word, which is cheaper and more
 * predictable to build here than to pull an ABI encoder in for.
 */

/** `keccak256("balanceOf(address)")[0:4]`. */
const BALANCE_OF_SELECTOR = '0x70a08231'

/** The balances the funding step decides on. */
export interface HoodBalances {
  /** Native ETH balance in wei. Gas comes out of this. */
  native: bigint
  /** USDG balance in base units (6 decimals). */
  usdg: bigint
}

/** Where balance reads are sent. */
export interface BalanceSource {
  /**
   * Read through the connected wallet. Correct by construction once the wallet
   * is on the target chain, and immune to browser CORS rules.
   */
  provider?: Eip1193Provider
  /**
   * Read over HTTP JSON-RPC instead. Use when you want balances independent of
   * whichever chain the wallet is currently pointed at. The endpoint must send
   * permissive CORS headers to be usable from a browser.
   */
  rpcUrl?: string
}

function encodeBalanceOf(address: string): `0x${string}` {
  const clean = address.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new HoodConnectError('balance-read-failed', `Not a valid address: ${address}`)
  }
  return `${BALANCE_OF_SELECTOR}${clean.padStart(64, '0')}` as `0x${string}`
}

async function rpcOverHttp(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) {
    throw new HoodConnectError('balance-read-failed', `RPC ${method} failed: HTTP ${response.status} from ${rpcUrl}`)
  }
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error) {
    throw new HoodConnectError('balance-read-failed', `RPC ${method} failed: ${body.error.message ?? 'unknown RPC error'}`)
  }
  return body.result
}

function makeCaller(source: BalanceSource): (method: string, params: unknown[]) => Promise<unknown> {
  if (source.provider) {
    const provider = source.provider
    return (method, params) => provider.request({ method, params })
  }
  if (source.rpcUrl) {
    const rpcUrl = source.rpcUrl
    return (method, params) => rpcOverHttp(rpcUrl, method, params)
  }
  throw new HoodConnectError('balance-read-failed', 'No balance source: pass either a connected provider or an rpcUrl.')
}

/**
 * Read the native and USDG balances for one address.
 *
 * Both reads are issued together; a failure in either rejects with a
 * `balance-read-failed` {@link HoodConnectError} rather than silently
 * reporting zero, because a zero read is what drives the "unfunded" state and
 * a wrong zero would send a funded user to the bridge.
 *
 * @example
 * ```ts
 * import { readBalances, hoodMainnet } from 'hood-connect'
 *
 * const balances = await readBalances(
 *   { rpcUrl: hoodMainnet.rpcUrl },
 *   hoodMainnet,
 *   '0x0000000000000000000000000000000000000001',
 * )
 * console.log(balances.native, balances.usdg)
 * ```
 */
export async function readBalances(
  source: BalanceSource,
  chain: HoodChainInfo,
  address: string,
): Promise<HoodBalances> {
  const call = makeCaller(source)
  const data = encodeBalanceOf(address)

  try {
    const [native, usdg] = await Promise.all([
      call('eth_getBalance', [address, 'latest']),
      call('eth_call', [{ to: chain.usdg, data }, 'latest']),
    ])
    return { native: hexToBigInt(native), usdg: hexToBigInt(usdg) }
  } catch (error) {
    throw toHoodConnectError(error, 'balance-read-failed')
  }
}
