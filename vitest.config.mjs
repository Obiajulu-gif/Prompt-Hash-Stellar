import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"] })],

  optimizeDeps: {
    exclude: ["@creit.tech/stellar-wallets-kit"],
    include: ["@stellar/stellar-sdk", "buffer"],
  },

  css: {
    modules: {
      classNameStrategy: "non-scoped",
    },
  },

  build: {
    commonjsOptions: {
      include: [/@creit.tech\/stellar-wallets-kit/, /node_modules/],
      transformMixedEsModules: true,
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    testTimeout: 15000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest}.config.*",
      "**/server/**",
      "src/test/similarityDetection.test.ts",
      "src/test/auditTrail.test.ts",
      "src/test/health.test.ts",
      "src/test/simulation.test.ts",
    ],
    server: {
      deps: {
        inline: [/@creit\.tech\/stellar-wallets-kit/, /libsodium-wrappers/],
      },
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "libsodium-wrappers": require.resolve("libsodium-wrappers"),
    },
  },
});
