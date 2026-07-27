import { defineConfig } from "vite";
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
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-radix": [
              "@radix-ui/react-avatar",
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-progress",
              "@radix-ui/react-select",
              "@radix-ui/react-slider",
              "@radix-ui/react-slot",
              "@radix-ui/react-tabs",
              "@radix-ui/react-tooltip",
            ],
            "vendor-stellar": [
              "@stellar/stellar-sdk",
              "@stellar/stellar-base",
              "@creit.tech/stellar-wallets-kit",
            ],
            "vendor-animation": ["framer-motion"],
            "vendor-charts": ["chart.js", "react-chartjs-2"],
            "vendor-markdown": ["react-markdown", "remark-gfm", "rehype-sanitize"],
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