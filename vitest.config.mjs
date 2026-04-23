import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ include: ['buffer'] }),
    {
      name: 'fix-libsodium-path',
      resolveId(id) {
        if (id.includes('libsodium.mjs')) {
          return path.resolve(__dirname, 'node_modules/libsodium-wrappers/dist/modules-esm/libsodium.mjs');
        }
      }
    }
  ],
  // Inside your vitest.config.mjs
  optimizeDeps: {
    exclude: ['@creit.tech/stellar-wallets-kit'],
    include: ['@stellar/stellar-sdk', 'buffer'],
  },

  build: {
    commonjsOptions: {
      // This allows the "require" based code inside the kit to work in the browser
      include: [/@creit.tech\/stellar-wallets-kit/, /node_modules/],
      transformMixedEsModules: true,
    },
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
      'libsodium-wrappers': require.resolve('libsodium-wrappers/dist/modules-esm/libsodium.mjs'),
    },
  },
})