// Root-level config used by the lefthook pre-commit hook when linting staged
// files from the monorepo root. Each package has its own eslint.config.js for
// per-package linting (pnpm lint).
export default [
  {
    ignores: ["pnpm-lock.yaml", "**/node_modules/**", "**/.next/**"],
  },
];
