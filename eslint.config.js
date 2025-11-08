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
    "src/contracts/*",
    "!src/contracts/util.ts",
  ]),
  {
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
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
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRoot: import.meta.dirname,
      },
    },
    rules: {
      // Turn all rules to warnings instead of errors
      'no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      "@typescript-eslint/require-await": "warn",
      // Or disable specific annoying rules
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "react-x/no-missing-key": "off",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "react-x/no-default-props": "off"
    },
  },
);
