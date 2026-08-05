import { KnipConfig } from "knip";

const config: KnipConfig = {
  treatConfigHintsAsErrors: true,
  ignore: [
    ".venv/**",
    "apps/**/src/lib/logging.ts",
    "apps/auth/src/lib/auth.ts",
    "packages/**/src/logger.ts",
    "packages/db/src/**",
    "packages/shared/src/app/constants.ts",
    ".claude/scripts/sync-agent-skills.mjs",
    ".github/scripts/code-scanning-issue.cjs",
    "tooling/typescript/type-extensions.d.ts",
    "turbo/generators/config.ts",
    // AI-SDLC factory tooling (fork-only). Its entry points are CI workflows
    // (e2e-triage / adversarial-review) invoking `tsx src/review-pr.ts` /
    // `triage-e2e-failure.ts`, so knip can't trace usage across the workflow
    // boundary and reports internal helpers as unused. It carries its own
    // vitest suite; follow-up to configure knip entries properly.
    "tooling/ci-factory/**",
  ],
  ignoreDependencies: ["@turbo/gen", "dotenv"],
  ignoreBinaries: ["uv"],
  workspaces: {
    ".": {
      // scripts/lint-staged.mjs spawns the eslint binary by path, so the root
      // devDependency is never a static import knip can follow.
      ignoreDependencies: ["eslint"],
    },
    "apps/api": {
      // The characterization suite runs under its own vitest config,
      // which the vitest plugin does not discover from the default name.
      vitest: ["vitest.config.ts", "vitest.characterization.config.ts"],
      // Wired in by resolve.alias rather than an import, so it is not
      // reachable through the module graph.
      entry: ["characterization/next-headers-shim.ts"],
    },
  },
};

export default config;
