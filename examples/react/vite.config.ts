import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The example resolves `hood-connect` straight to the source in this repo, so
 * running it exercises the code you just edited rather than a stale build.
 * In your own app you would delete these aliases and let npm resolve the
 * published package.
 */
const src = (path: string): string => fileURLToPath(new URL(`../../src/${path}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'hood-connect/react': src('react/index.tsx'),
      'hood-connect/element': src('element/index.ts'),
      'hood-connect': src('index.ts'),
    },
  },
  server: { port: 5173 },
})
