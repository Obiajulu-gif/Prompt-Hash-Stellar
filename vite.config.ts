import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

// https://vite.dev/config/
const plugins = [
  react(),
  nodePolyfills({
    include: ["buffer"],
    globals: {
      Buffer: true,
    },
  }),
  wasm(),
];

// 2. ONLY dynamic require/inject Sentry if an auth token is physically available in the environment (e.g., inside CI)
if (process.env.SENTRY_AUTH_TOKEN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sentryVitePlugin } = require("@sentry/vite-plugin");
    plugins.push(
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
      })
    );
  } catch (e) {
    console.warn("Sentry plugin configuration found but module package files could not be evaluated.");
  }
}

export default defineConfig({
  plugins,
  resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "libsodium-wrappers": path.resolve(
          __dirname,
          "./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js"
        ),
      },
    },
    build: {
      target: "esnext",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules")) {
              if (
                id.includes("react-router-dom") ||
                id.includes("/react/") ||
                id.includes("/react-dom/")
              ) {
                return "vendor-react";
              }
              if (id.includes("@radix-ui")) {
                return "vendor-radix";
              }
              if (
                id.includes("@stellar") ||
                id.includes("@creit.tech/stellar-wallets-kit")
              ) {
                return "vendor-stellar";
              }
              if (id.includes("framer-motion")) {
                return "vendor-animation";
              }
              if (id.includes("chart.js") || id.includes("react-chartjs-2")) {
                return "vendor-charts";
              }
              if (
                id.includes("react-markdown") ||
                id.includes("remark-gfm") ||
                id.includes("rehype-sanitize")
              ) {
                return "vendor-markdown";
              }
            }
          },
        },
      },
    },
    define: {
      global: "window",
    },
    envPrefix: "PUBLIC_",
    test: {
      environment: "node",
    },
    server: {
      // Bind all interfaces so the dev server is reachable when running inside
      // a container (docker-compose / Dev Containers).
      host: true,
      watch: {
        // File-system events do not always cross the host/container boundary
        // (notably on Windows and macOS bind mounts), so allow opting into
        // polling via VITE_DEV_POLLING — see docker-compose.yml.
        usePolling: process.env.VITE_DEV_POLLING === "true",
      },
      proxy: {
        "/friendbot": {
          target: "https://friendbot.stellar.org",
          changeOrigin: true,
        },
        "/api": {
          // Defaults to the local API server; overridden to the api service
          // name when running under docker-compose.
          target: process.env.API_PROXY_TARGET || "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
});