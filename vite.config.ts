import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
// import tailwindcss from '@tailwindcss/vite';
import path from "path";
// Sentry source-map upload plugin (#332).
// Active only when SENTRY_AUTH_TOKEN is set (i.e. in CI).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sentryVitePlugin } = require("@sentry/vite-plugin");

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      // tailwindcss(),
      nodePolyfills({
        include: ["buffer"],
        globals: {
          Buffer: true,
        },
      }),
      wasm(),
      // Upload source maps to Sentry on production builds when credentials
      // are available.  Set SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT in
      // CI/CD environment variables (#332).
      ...(process.env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
              telemetry: false,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "libsodium-wrappers": path.resolve(
          __dirname,
          "./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js",
        ),
      },
    },
    build: {
      target: "esnext",
      // Required so Sentry can map minified bundles back to source (#332).
      sourcemap: true,
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
          // target: "http://localhost:8000/friendbot",
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
  };
});
