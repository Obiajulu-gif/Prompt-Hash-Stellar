import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite's default PostCSS config search climbs to the repo root and picks
  // up the frontend's postcss.config.js (Tailwind), which isn't installed
  // in this package's own node_modules. The server has no CSS to process,
  // so short-circuit the search instead of pulling in frontend tooling.
  css: {
    postcss: {},
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      // Jest-style suites (jest.mock/jest.fn globals) — not yet migrated to vitest.
      "src/tests/pagination.test.ts",
      "src/tests/auditTrail.test.ts",
    ],
  },
});
