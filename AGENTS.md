# Repository Guidelines

## AI-Assisted Development

Most contributors work with AI assistants. This file (`AGENTS.md`) is the
**canonical, tool-agnostic source of truth**; each assistant has a thin pointer
file that routes back here so guidance never drifts:

- **Claude** → [`CLAUDE.md`](CLAUDE.md)
- **GitHub Copilot** → [`.github/copilot-instructions.md`](.github/copilot-instructions.md)
- **Cursor** → [`.cursor/rules/f3-project-guidelines.mdc`](.cursor/rules/f3-project-guidelines.mdc)

Deeper guidance lives in `docs/`:

- [`docs/AI_GUARDRAILS.md`](docs/AI_GUARDRAILS.md) — operating boundaries
  (Always / Never / Can) and the domains where humans always have final say
  (security, availability/reliability, scalability).
- [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md) — secure patterns
  and pitfalls to avoid (API authorization, auth/tokens, secrets, web security,
  data layer, multi-instance reliability) with a pre-flight checklist.
- [`docs/AI_AUDIT_PLAYBOOK.md`](docs/AI_AUDIT_PLAYBOOK.md) — how to run a
  repository audit and file high-quality issues.
- [`specs/`](specs/) — feature specs: the source of truth for **what** a
  feature does, who may do it, and how it's verified. Read the relevant spec
  before doing feature work (the docs above cover conventions and security;
  specs cover behavior).

When adding durable guidance, put it in `AGENTS.md` (or `docs/` for deep topics
and link it) and keep the tool pointer files thin. Per-app specifics belong in
that app's `AGENTS.md`.

### Agent skills

Reusable agent skills (procedural runbooks in the
[Agent Skills](https://agentskills.io) `SKILL.md` format) live in
[`.agents/skills/`](.agents/skills/) — the cross-vendor convention scanned
natively by Cursor, Codex, Gemini CLI, and others. Claude Code only scans
`.claude/skills/`, so a `SessionStart` hook (`.claude/settings.json`) runs
[`.claude/scripts/sync-agent-skills.mjs`](.claude/scripts/sync-agent-skills.mjs) to mirror
`.agents/skills/` into the gitignored `.claude/skills/`. Add or edit skills in
`.agents/skills/` only; never commit anything under `.claude/skills/`.

## Project Structure & Module Organization

- Use Node >=24.18 (see `.nvmrc`), pnpm 11, and Turborepo for workspace orchestration.
- Deployable apps live in `apps/`, shared code in `packages/`, config in `tooling/`, and Turbo generators in `turbo/`.

## Environment Setup

- **Cross-platform:** All shell scripts use `#!/usr/bin/env bash` and are tested on **macOS** and **WSL 2** (Ubuntu). Windows developers must use WSL 2 — do not run scripts in native Windows shells (cmd, PowerShell). Never write macOS-only commands (`brew`, `open`, `launchctl`) or Windows-only paths without a Linux fallback.
- Node and pnpm are managed via NVM. The pnpm binary lives at `~/.nvm/versions/node/$(node --version)/bin/pnpm` under the currently active Node version. If `pnpm` is not on `PATH`, prepend that directory to `PATH` or run `. ~/.nvm/nvm.sh && nvm use` before running pnpm commands.
- The recommended local dev environment uses Docker. Run `pnpm local:setup` once after cloning; see [docs/LOCAL_DEV_DOCKER.md](docs/LOCAL_DEV_DOCKER.md) for setup instructions covering both macOS and WSL 2.

## Build, Test, and Development Commands

- **First-time setup:** `pnpm local:setup` — copies per-directory `.env` files, starts Docker services, runs migrations, and seeds the database. See [docs/LOCAL_DEV_DOCKER.md](docs/LOCAL_DEV_DOCKER.md) for the full guide.
- **Docker services:** `pnpm docker:up` to start (Postgres, Adminer, GCS emulator, Mailpit), `pnpm docker:down` to stop.
- Each app and `packages/env` has its own `.env` file (copied from `.env.example` by `pnpm local:setup`). Never commit `.env` files.
- Code quality: always run `pnpm lint` (or `pnpm lint --filter apps/map`) and `pnpm format:fix` to ensure your code passes all lint and formatting checks. Also run `pnpm typecheck` to validate types.
- Database helpers: `pnpm db:pull`, `pnpm db:push`, and `pnpm reset-test-db`.
- Every other build/dev/test command is a standard Turborepo invocation — see the root `package.json` scripts.

## Coding Style & Naming Conventions

- Use Prettier (`@acme/prettier-config`) and ESLint (`@acme/eslint-config` base/next/react) as the source of truth.
- Always autofix issues with `pnpm lint:fix` and confirm changes with `pnpm lint` and `pnpm format` before committing.
- Name React components in PascalCase, prefix hooks with `use`, and use kebab-case for files/directories (e.g., `apps/map/src`).
- Co-locate feature-specific assets and tests near their sources (e.g., `apps/map/src/app/(feature)/`).

## Logging

- Log through the shared [`@acme/logger`](packages/logger/README.md) package,
  imported from the app's `lib/logging` module — never `console.*`. There is one
  helper per level: `logTrace` / `logDebug` / `logInfo` / `logWarn` / `logError`
  / `logFatal`. Prefer these for all event logging; reach for the raw `logger`
  only for request-scoped children (`logger.child({ requestId })`). The helpers
  take the `event` **first**; pino's native methods take the context object
  first — don't mix the orders.
- The **first argument is a dot-namespaced `event` identifier**, not a sentence:
  `<area>.<feature>.<outcome>`, lowercase with `snake_case` segments (e.g.
  `auth.register.f3_api_error`, `me.avatar.upload_failed`). Keep it a fixed
  string literal — never interpolate variable data into it.
- Put per-occurrence data in the structured `ctx` object (second arg) and the
  thrown value in `err` (third arg of `logError`): `logError("api.rpc.handler_error", { orgId }, err)`.
- Never log secrets or PII — see [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data).
- New to the logging setup? [`docs/LOGGING.md`](docs/LOGGING.md) is the
  human-facing primer (why pino, how to use it, controlling `LOG_LEVEL`);
  [`packages/logger/README.md`](packages/logger/README.md) is the full API reference.

## GitHub Actions Conventions

- **Pin third-party actions to a full commit SHA with a version comment** (e.g. `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`). SHAs are immutable — a semver tag can be force-pushed, a SHA cannot. Renovate (`pinDigests: true`) keeps the SHAs up to date automatically.
- Drive the Node version from `.nvmrc` via `actions/setup-node` (`node-version-file: .nvmrc`) — `.nvmrc` is the single source of truth. Never hardcode `node-version:` in a workflow.
- **Set the Docker target platform at build time, not in the `Dockerfile`.** Cloud Run only runs `linux/amd64`. The app `Dockerfile` `FROM` lines must **not** pin `--platform` (BuildKit's `FromPlatformFlagConstDisallowed` lint, and it forces emulation on arm64 dev machines). Instead pass the platform at the build invocation: `platforms: linux/amd64` on `docker/build-push-action` (CI) and `--platform=linux/amd64` on `docker build` (deploy). Building a **deployable** image locally on Apple Silicon therefore requires an explicit `docker build --platform=linux/amd64 …`. Do **not** switch to `$BUILDPLATFORM` cross-builds — `sharp`'s native binaries are platform-specific and would break in the amd64 runtime.
- Share toolchain setup through the composite action [`.github/actions/setup`](.github/actions/setup/action.yml) (pnpm + Node + pnpm-store cache + frozen install) instead of repeating setup steps per job.
- The five CI check names (`format-check`, `lint`, `typecheck`, `build`, `test-coverage`) are referenced by the `main` branch ruleset and by `check-regexp` in the deploy workflows — renaming a job requires updating both.

## Testing Guidelines

- Use Vitest for unit and integration tests; name test files `*.test.ts[x]` and place under or near source code or in `__tests__`.
- Reset databases before any suite that mutates data (`pnpm reset-test-db` or `pnpm -C packages/db reset-test-db`).
- Prefer fixtures in `apps/map/tests` or `packages/*/__mocks__` instead of live service calls.
- How coverage is measured and why thresholds are set the way they are (Vitest 4's whole-`src` denominator, shared `coverageInclude`/`coverageExclude`): [`docs/testing.md`](docs/testing.md).
- **Never set `test.coverage.thresholds.autoUpdate` to `false`, and never remove
  the key** (its default is `false`, so deleting it has the same effect). Vitest
  ratchets the threshold numbers in `vitest.config.ts` upward as coverage
  improves — a config file modified by a test run is **expected**, and that
  change should be committed, not reverted or suppressed. Lowering or freezing
  thresholds to make a failing suite pass is not an acceptable fix; add the
  missing tests instead. Enforced by
  [`scripts/check-vitest-thresholds.mjs`](scripts/check-vitest-thresholds.mjs),
  which runs in `pnpm lint` (and therefore CI) and as a `pre-commit` job.

### Driving auth-bounded flows in local dev

Apps that require sign-in (e.g. `apps/map`, `apps/me`) authenticate via `apps/auth`, which uses email-based MFA. **No real inbox is involved** — outbound mail is captured locally, and agents drive the full sign-in flow headlessly by reading the 6-digit code from it.

The full recipe lives in [`apps/auth/AGENTS.md`](apps/auth/AGENTS.md) (loaded automatically when working under `apps/auth`) and [`docs/QA_LOCAL_AUTH.md`](docs/QA_LOCAL_AUTH.md).

## Commit Message Convention

This repo enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint + Lefthook. Every commit message **must** follow:

```
<type>(<scope>): <subject>
```

**Scope is required.** The Lefthook `commit-msg` hook will reject commits that omit it or use an unrecognized scope.

### Types

Use standard Conventional Commit types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.

### Scopes

Scopes are defined in `commitlint.config.mjs` and map to monorepo packages:

| Category        | Scopes                                                              |
| --------------- | ------------------------------------------------------------------- |
| Apps            | `admin`, `homepage`, `map`, `me`                                    |
| Apps & Packages | `api`, `auth` (exist in both `apps/` and `packages/`)               |
| Packages        | `db`, `env`, `mail`, `shared`, `sso`, `storage`, `ui`, `validators` |
| Tooling         | `eslint`, `prettier`, `tsconfig`, `scripts`, `github`, `tailwind`   |
| Cross-cutting   | `deps`, `ci`, `repo`, `release`, `main` (used by Release Please)    |

**Choosing a scope:**

- Use the app or package the change primarily affects (e.g., `fix(db): correct migration`)
- For dependency updates: `chore(deps): bump next to 15.1`
- For CI/GitHub Actions: `ci(ci): add deploy workflow`
- For root config, monorepo tooling, or multi-package changes: `chore(repo): update turbo pipeline`
- For release-related changes: `chore(release): v3.10.0`

**When adding a new workspace**, add its scope to the array in `commitlint.config.mjs`.

## Pull Request Guidelines

- Every pull request should:
  - Include a clear summary, any related issue(s), commands run, and impact to DB/env.
  - Add screenshots or screen recordings for UI changes in `apps/map`.
  - Highlight any new migrations or environment variables.
  - Never include secrets.
- Before opening a pull request, ensure both `pnpm lint` and `pnpm format` pass with no errors or changes required.

## Security & Environment

- Store all secrets in per-directory `.env` files (one per app and `packages/env`). Always use `with-env` helpers to load environment variables and never commit `.env` files to the repo.
- Scope Sentry/analytics keys per environment and rotate if leaked. Run production DB changes only through scripts in `packages/db`.
