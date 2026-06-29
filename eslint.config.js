import js from "@eslint/js";
import globals from "globals";
// import reactDOM from "eslint-plugin-react-dom";
// import reactHooks from "eslint-plugin-react-hooks";
// import reactRefresh from "eslint-plugin-react-refresh";
// import reactX from "eslint-plugin-react-x";
import tseslint from "typescript-eslint";
// import prettier from "eslint-config-prettier";
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
      // reactDOM.configs.recommended,
      // reactHooks.configs["recommended-latest"],
      // reactRefresh.configs.vite,
      // reactX.configs["recommended-typescript"],
      // prettier,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Turn all rules to warnings instead of errors
      "no-unused-vars": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/require-await": "off",
      // Or disable specific annoying rules
      "react/prop-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "react-x/no-missing-key": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prefer-const": "warn",
      "react-hooks/exhaustive-deps": "off",
      "react-x/no-array-index-key": "off",
      "react-x/no-nested-component-definitions": "off",
      "react-x/jsx-key-before-spread": "off",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "react-x/no-default-props": "off",
    },
  },
);
