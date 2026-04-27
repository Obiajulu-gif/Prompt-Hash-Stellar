import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
// import tailwindcss from '@tailwindcss/vite';
import path from "path";

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
    },
    define: {
      global: "window",
    },
    envPrefix: "PUBLIC_",
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
    },
    server: {
      proxy: {
        "/friendbot": {
          // target: "http://localhost:8000/friendbot",
          target: "https://friendbot.stellar.org",
          changeOrigin: true,
        },
      },
    },
  };
});
