import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

// https://vite.dev/config/
export default defineConfig(() => {
  // 1. Build out your core stable plugin array matrix
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

  return {
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
    },
    define: {
      global: "window",
    },
    envPrefix: "PUBLIC_",
    test: {
      environment: "node",
    },
    server: {
      proxy: {
        "/friendbot": {
          target: "https://friendbot.stellar.org",
          changeOrigin: true,
        },
        "/api": {
          target: "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
  };
});