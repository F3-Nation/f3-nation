import { KnipConfig } from "knip";

// @acme/eslint-config/tailwind resolves tailwindcss from each workspace at
// lint time; no import exists for knip to trace.
const tailwindLintDeps = ["tailwindcss"];

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
    ".github/scripts/ready-for-human-review-label.cjs",
  ],
  ignoreBinaries: [
    "uv",
    // Postgres CLIs the obfuscator's verify harness shells out to.
    "initdb",
    "pg_ctl",
    "pg_isready",
    "createdb",
    // The staging refresh restarts the staging slackbot with gcloud when it
    // runs outside Cloud Run (best effort; never a dependency).
    "gcloud",
  ],
  workspaces: {
    "packages/logger": {
      // index.test.ts executes this fixture in a separate Node process so
      // real pino output can be checked without Vitest's logger mocks.
      entry: ["src/__tests__/fixtures/audit-log-output.ts"],
    },
    ".": {
      // scripts/lint-staged.mjs spawns the eslint binary by path, so the root
      // devDependency is never a static import knip can follow.
      ignoreDependencies: ["eslint"],
      // ci.yml's test-coverage job boots the esbuild bundle from a
      // runner-temp directory copied there at CI time (outside the checkout,
      // deliberately — see build.mjs), so `./instrument.js` never exists as a
      // real repo file for knip's GitHub Actions plugin to resolve.
      ignoreUnresolved: ["./instrument.js"],
      // Run by scripts/lint.sh, which knip does not parse.
      entry: [
        "scripts/check-eslint-suppressions.mjs",
        "scripts/check-review-links.mjs",
        "scripts/check-security-headers-coverage.mjs",
      ],
    },
    "apps/api": {
      // The characterization suite runs under its own vitest config,
      // which the vitest plugin does not discover from the default name.
      vitest: ["vitest.config.ts", "vitest.characterization.config.ts"],
      // src/server.ts needs no entry here — knip's package.json plugin
      // already discovers it via the dev/start scripts. scripts/smoke.mjs is
      // run only by the Dockerfile's smoke stage, which knip does not parse.
      entry: ["scripts/smoke.mjs"],
    },
    "apps/auth": {
      // knip parses `dotenv run -q --` as a binary named `run`; `dotenv` is
      // the CLI shipped by the `dotenv` package itself.
      ignoreBinaries: ["run"],
      ignoreDependencies: tailwindLintDeps,
    },
    "apps/admin": {
      // vi.mock("@f3nation/sso") in auth-login tests intercepts handleLoginRoute's
      // internal call; no static import exists for knip to trace.
      ignoreDependencies: ["@f3nation/sso", ...tailwindLintDeps],
    },
    "apps/homepage": { ignoreDependencies: tailwindLintDeps },
    "apps/map": { ignoreDependencies: tailwindLintDeps },
    "apps/me": {
      // vi.mock("@f3nation/sso") in auth-login tests intercepts handleLoginRoute's
      // internal call; no static import exists for knip to trace.
      ignoreDependencies: ["@f3nation/sso", ...tailwindLintDeps],
    },
    "packages/ui": {
      // Its Tailwind lint entry point is @acme/tailwind-config/web.css.
      ignoreDependencies: [...tailwindLintDeps, "@acme/tailwind-config"],
    },
    "apps/slackbot": {
      // Graph-only edge mirroring apps/slackbot/pyproject.toml so Turbo can see
      // the Python workspace; no TypeScript imports it.
      ignoreDependencies: ["f3-data-models"],
    },
  },
};

export default config;
