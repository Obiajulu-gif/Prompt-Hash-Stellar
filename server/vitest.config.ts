import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
      // Resolve the shared schema package from source. Its published entry
      // points at ./dist, which is only produced by `npm run build` inside
      // packages/schema and is not built by CI before tests run.
      "@prompthash/schema": fileURLToPath(
        new URL("../packages/schema/src/index.ts", import.meta.url),
      ),
      // A few server modules consume frontend helpers through the `@/` alias.
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      // Jest-style suites (jest.mock/jest.fn globals) — not yet migrated to vitest.
      "src/tests/auditTrail.test.ts",
      "src/tests/versioning.test.ts",
      // Requires live mongodb download/daemon in memory
      "src/tests/projectionReplay.test.ts",
    ],
  },
});
