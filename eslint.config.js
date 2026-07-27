import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  globalIgnores([
    "dist",
    "packages",
    "src/debug/**",
    "src/pages/Debugger.tsx",
    "src/contracts/*",
    "!src/contracts/util.ts",
  ]),
  {
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    // Removed the plugins key entirely to stop the legacy array format extraction crash
    rules: {
      "no-unused-vars": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/require-await": "off",
      "react/prop-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "react-x/no-missing-key": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prefer-const": "warn",
      "react-x/no-array-index-key": "off",
      "react-x/no-nested-component-definitions": "off",
      "react-x/jsx-key-before-spread": "off",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "react-x/no-default-props": "off",
    },
  },
);