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
        project: ["./tsconfig.node.json", "./tsconfig.app.json", "./server/tsconfig.json", "./tsconfig.eslint.json"],
        tsconfigRoot: import.meta.dirname,
      },
    },
    rules: {
      // Turn all rules to warnings instead of errors
      "no-unused-vars": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/require-await": "warn",
      // Or disable specific annoying rules
      "react/prop-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
    },
  },
);
