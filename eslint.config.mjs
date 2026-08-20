import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@next/next": next,
      "react-hooks": reactHooks,
    },
    rules: {
      ...next.configs["core-web-vitals"].rules,
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
];

export default eslintConfig;
