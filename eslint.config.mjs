import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const claudeSdk = {
  group: ["@anthropic-ai/*"],
  message: "Only src/teacher talks to Claude. Call the Teacher instead.",
};
const polarSdk = {
  group: ["@polar-sh/*"],
  message: "Only src/payments talks to Polar. Call `payments` instead.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The teacher module is the only one that talks to Claude, and the
  // payments module the only one that talks to Polar. Each block restricts
  // both, less what its own module may import, since a later block's
  // no-restricted-imports replaces an earlier one's.
  {
    ignores: ["src/teacher/**", "src/payments/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [claudeSdk, polarSdk] }] },
  },
  {
    files: ["src/teacher/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [polarSdk] }] },
  },
  {
    files: ["src/payments/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [claudeSdk] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design prototype files, not app code.
    "design/**",
  ]),
]);

export default eslintConfig;
