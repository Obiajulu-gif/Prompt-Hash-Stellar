import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

// Standard ESM fix for __dirname and require
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ include: ['buffer'] }),
  ],

  optimizeDeps: {
    exclude: ['@creit.tech/stellar-wallets-kit'],
    include: ['@stellar/stellar-sdk', 'buffer'],
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    server: {
      deps: {
        inline: [/@creit.tech\/stellar-wallets-kit/, /libsodium-wrappers/],
      }
    }
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'libsodium-wrappers': require.resolve('libsodium-wrappers'),
    },
  },
})