import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Vite's default PostCSS config search climbs to the repo root and picks
  // up the frontend's postcss.config.js (Tailwind), which isn't installed
  // in this package's own node_modules. The server has no CSS to process,
  // so short-circuit the search instead of pulling in frontend tooling.
  css: {
    postcss: {},
  },
  resolve: {
    alias: {
      "@prompthash/schema": path.resolve(__dirname, "../packages/schema/src/index.ts"),
      "@": path.resolve(__dirname, "../src"),
    },
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      // Jest-style suites (jest.mock/jest.fn globals) — not yet migrated to vitest.
      "src/tests/auditTrail.test.ts",
    ],
  },
});
