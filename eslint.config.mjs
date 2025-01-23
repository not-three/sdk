import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {ignores: ["**/src/types/api/**"]},
  {files: ["**/*.{js,mjs,cjs,ts}"] },
  {languageOptions: { globals: {...globals.browser, ...globals.node} }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {rules: {"semi": ["error", "always"]}},
  eslintConfigPrettier,
];
