import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    'wagmi/index': 'src/wagmi/index.ts',
    'element/index': 'src/element/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['viem', 'react', 'react-dom', 'wagmi', '@wagmi/core', 'qrcode-generator'],
})
