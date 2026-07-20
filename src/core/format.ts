/**
 * Formatting helpers.
 *
 * These are deliberately local rather than imported from `viem`. `viem` is a
 * peer dependency used for the wagmi surface and for types, but the core flow
 * and the web component must run with nothing installed alongside them, so the
 * two functions the UI actually needs are implemented here exactly.
 */

/** Render a base-unit integer as a decimal string. Exact, never lossy. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * Render a base-unit integer for display: at most `maxFractionDigits` decimals,
 * truncated (never rounded up, so a balance is never shown as more than it is).
 */
export function formatBalance(value: bigint, decimals: number, maxFractionDigits = 4): string {
  const full = formatUnits(value, decimals)
  const dot = full.indexOf('.')
  if (dot === -1) return full
  if (maxFractionDigits === 0) return full.slice(0, dot)
  const truncated = full.slice(0, dot + 1 + maxFractionDigits).replace(/\.?0+$/, '')
  if (truncated === '' || truncated === '-') return '0'
  // A non-zero balance smaller than the display precision must not read as 0.
  if (value !== 0n && /^-?0$/.test(truncated)) {
    return `<0.${'0'.repeat(maxFractionDigits - 1)}1`
  }
  return truncated
}

/** Shorten an address for display: `0x1234...cdef`. */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 3) return address
  return `${address.slice(0, lead)}...${address.slice(-tail)}`
}

/** Hex quantity to bigint. Tolerates `0x`, empty, and non-hex by returning 0n. */
export function hexToBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value !== 'string') return 0n
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '0x' || trimmed === '0X') return 0n
  try {
    return BigInt(trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`)
  } catch {
    return 0n
  }
}
