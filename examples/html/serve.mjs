#!/usr/bin/env node
/**
 * A dependency-free static server for the web-component example.
 *
 * It serves three roots so the page can load the real build output rather than
 * a copy: `/` is this directory, `/dist` is the package build, and `/vendor` is
 * the optional UMD QR encoder from node_modules.
 *
 * Usage, from the repository root:
 *
 *   npm run build
 *   npm run example:html
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// `resolvePath` strips the trailing separator that `fileURLToPath` leaves on a
// directory URL, which the containment check below depends on.
const here = resolvePath(fileURLToPath(new URL('.', import.meta.url)))
const packageRoot = resolvePath(fileURLToPath(new URL('../../', import.meta.url)))

const ROOTS = [
  { prefix: '/dist/', dir: join(packageRoot, 'dist') },
  { prefix: '/vendor/', dir: join(packageRoot, 'node_modules', 'qrcode-generator') },
  { prefix: '/', dir: here },
]

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
])

const PORT = Number(process.env['PORT'] ?? 5174)

/** Resolve a URL path to a file, refusing anything that escapes its root. */
function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const wanted = decoded === '/' ? '/index.html' : decoded

  for (const root of ROOTS) {
    if (!wanted.startsWith(root.prefix)) continue
    const relative = normalize(wanted.slice(root.prefix.length)).replace(/^(\.\.[/\\])+/, '')
    const file = join(root.dir, relative)
    if (file !== root.dir && !file.startsWith(root.dir + sep)) continue
    return file
  }
  return null
}

const server = createServer(async (request, response) => {
  const file = resolve(request.url ?? '/')

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
    return
  }

  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    response.writeHead(200, {
      'content-type': TYPES.get(extname(file)) ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    createReadStream(file).pipe(response)
  } catch {
    const hint = file.includes(`${sep}dist${sep}`)
      ? 'Build the package first: npm run build'
      : `No such file: ${file}`
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(hint)
  }
})

server.listen(PORT, () => {
  console.log(`hood-connect web component example: http://localhost:${PORT}`)
  console.log('Serving  /       ->', here)
  console.log('Serving  /dist   ->', join(packageRoot, 'dist'))
  console.log('Serving  /vendor ->', join(packageRoot, 'node_modules', 'qrcode-generator'))
})
