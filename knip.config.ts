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
    "scripts/sync-agent-skills.mjs",
    "tooling/typescript/type-extensions.d.ts",
    "turbo/generators/config.ts",
  ],
  ignoreDependencies: [
    "@turbo/gen",
    "dayjs",
    "dotenv",
    "esbuild-register",
    "tsx",
  ],
  ignoreBinaries: ["uv"],
  workspaces: {
    "tooling/scripts": {
      entry: ["src/notify-outstanding-requests.ts", "src/script.ts"],
    },
  },
};

export default config;
