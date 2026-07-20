/**
 * Optional QR rendering for the "receive to this address" funding route.
 *
 * `qrcode-generator` is an optional peer dependency, not a hard one. Consumers
 * who install it get a scannable EIP-681 QR code in the funding step; those who
 * do not still get the copyable address, the explorer link, and the payment
 * URI, which is the path that always works. That is a deliberate trade: a
 * wallet-onboarding component should not force a QR encoder into a bundle that
 * may never render one.
 */

/** A square matrix of QR modules. `true` is a dark module. */
export interface QrMatrix {
  size: number
  modules: readonly (readonly boolean[])[]
}

let loader: Promise<QrFactory | null> | null = null

type QrFactory = (typeNumber: number, errorCorrectionLevel: string) => {
  addData(data: string): void
  make(): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}

async function loadFactory(): Promise<QrFactory | null> {
  // `qrcode-generator` ships as UMD, so a page with no bundler cannot import it
  // by bare specifier but can load it with one script tag. Checking the global
  // first is what lets the web component render a QR on a plain HTML page.
  const fromGlobal = (globalThis as { qrcode?: unknown }).qrcode
  if (typeof fromGlobal === 'function') return fromGlobal as QrFactory

  loader ??= import('qrcode-generator')
    .then((module) => (module.default ?? module) as unknown as QrFactory)
    .catch(() => null)
  return loader
}

/**
 * Encode `text` as a QR matrix, or resolve `null` when `qrcode-generator` is
 * not installed.
 *
 * Type number 0 selects the smallest version that fits the payload; error
 * correction level `M` is the usual choice for on-screen codes, since there is
 * no print damage to recover from.
 *
 * @example
 * ```ts
 * import { generateQr, qrToSvgPath } from 'hood-connect'
 *
 * const matrix = await generateQr('ethereum:0x0000000000000000000000000000000000000001@4663')
 * if (matrix) console.log(qrToSvgPath(matrix).slice(0, 8))
 * ```
 */
export async function generateQr(text: string): Promise<QrMatrix | null> {
  if (!text) return null
  const factory = await loadFactory()
  if (!factory) return null
  try {
    const qr = factory(0, 'M')
    qr.addData(text)
    qr.make()
    const size = qr.getModuleCount()
    const modules: boolean[][] = []
    for (let row = 0; row < size; row += 1) {
      const line: boolean[] = []
      for (let col = 0; col < size; col += 1) line.push(qr.isDark(row, col))
      modules.push(line)
    }
    return { size, modules }
  } catch {
    return null
  }
}

/**
 * Convert a matrix to a single SVG path `d` attribute: one `M x y h1 v1 h-1 z`
 * subpath per dark module. One path element scales crisply and keeps the DOM
 * to a single node instead of several hundred rects.
 */
export function qrToSvgPath(matrix: QrMatrix): string {
  const parts: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.modules[row]
    if (!line) continue
    for (let col = 0; col < matrix.size; col += 1) {
      if (line[col]) parts.push(`M${col} ${row}h1v1h-1z`)
    }
  }
  return parts.join('')
}

/** The `viewBox` for a matrix, including the four-module quiet zone. */
export function qrViewBox(matrix: QrMatrix): string {
  return `-4 -4 ${matrix.size + 8} ${matrix.size + 8}`
}
