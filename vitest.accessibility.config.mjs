/**
 * Vitest configuration for accessibility testing.
 * Runs axe-core checks on critical components.
 * 
 * Usage:
 *   npm run test:a11y
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/a11y/setup.ts'],
    include: ['src/**/*.a11y.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
