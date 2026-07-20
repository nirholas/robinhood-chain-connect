import { describe, expect, it } from 'vitest'
import { generateQr, qrToSvgPath, qrViewBox } from '../src/ui/qr.js'
import { buildPaymentUri } from '../src/core/funding.js'
import { hoodMainnet } from '../src/core/chains.js'

const URI = buildPaymentUri(hoodMainnet, '0x1111111111111111111111111111111111111111')

describe('generateQr', () => {
  it('encodes an EIP-681 payment URI into a square matrix', async () => {
    const matrix = await generateQr(URI)
    expect(matrix).not.toBeNull()
    expect(matrix?.size).toBeGreaterThanOrEqual(21)
    expect(matrix?.modules).toHaveLength(matrix?.size ?? 0)
    for (const row of matrix?.modules ?? []) expect(row).toHaveLength(matrix?.size ?? 0)
  })

  it('places the three finder patterns a QR reader looks for', async () => {
    const matrix = await generateQr(URI)
    if (!matrix) throw new Error('qrcode-generator is required for this test')
    const { modules, size } = matrix
    // A finder pattern is a 7x7 block with a dark border and a 3x3 dark core.
    const isFinder = (top: number, left: number): boolean => {
      for (let column = 0; column < 7; column += 1) {
        if (!modules[top]?.[left + column] || !modules[top + 6]?.[left + column]) return false
      }
      for (let row = 2; row < 5; row += 1) {
        for (let column = 2; column < 5; column += 1) {
          if (!modules[top + row]?.[left + column]) return false
        }
      }
      return true
    }
    expect(isFinder(0, 0)).toBe(true)
    expect(isFinder(0, size - 7)).toBe(true)
    expect(isFinder(size - 7, 0)).toBe(true)
  })

  it('grows the version as the payload grows', async () => {
    const small = await generateQr('ethereum:0x1@4663')
    const large = await generateQr(`${URI}?value=${'1'.repeat(200)}`)
    expect(small?.size).toBeLessThan(large?.size ?? 0)
  })

  it('returns null for empty input rather than an empty code', async () => {
    expect(await generateQr('')).toBeNull()
  })

  it('builds an SVG path with one subpath per dark module', async () => {
    const matrix = await generateQr(URI)
    if (!matrix) throw new Error('qrcode-generator is required for this test')
    const path = qrToSvgPath(matrix)
    const dark = matrix.modules.flat().filter(Boolean).length
    expect(path.split('M').length - 1).toBe(dark)
    expect(path.startsWith('M0 0')).toBe(true)
  })

  it('includes the four-module quiet zone in the viewBox', async () => {
    const matrix = await generateQr(URI)
    if (!matrix) throw new Error('qrcode-generator is required for this test')
    expect(qrViewBox(matrix)).toBe(`-4 -4 ${matrix.size + 8} ${matrix.size + 8}`)
  })

  it('prefers a UMD global, so a page with no bundler still renders a code', async () => {
    const calls: string[] = []
    const stub = (): { addData(data: string): void; make(): void; getModuleCount(): number; isDark(): boolean } => ({
      addData: (data) => calls.push(data),
      make: () => undefined,
      getModuleCount: () => 1,
      isDark: () => true,
    })
    const globals = globalThis as { qrcode?: unknown }
    const original = globals.qrcode
    globals.qrcode = stub
    try {
      const matrix = await generateQr('from-global')
      expect(matrix).toEqual({ size: 1, modules: [[true]] })
      expect(calls).toEqual(['from-global'])
    } finally {
      if (original === undefined) delete globals.qrcode
      else globals.qrcode = original
    }
  })
})
