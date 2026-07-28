import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      // Jest-style suites (jest.mock/jest.fn globals) — not yet migrated to vitest.
      "src/tests/pagination.test.ts",
      "src/tests/auditTrail.test.ts",
      "src/tests/adversarial.test.ts",
    ],
  },
});
