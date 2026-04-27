import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  globalIgnores([
    "dist/**",
    "packages/**",
    "server/**",
    "api/**",
    "src/debug/**",
    "src/contracts/**",
    "src/pages/Debugger.tsx",
    "src/components/GuessTheNumber.tsx",
    "vitest.config.mjs",
  ]),
  {
    extends: [js.configs.recommended, tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
);