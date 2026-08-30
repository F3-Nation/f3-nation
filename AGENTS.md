# Repository Guidelines

## AI-Assisted Development

Most contributors work with AI assistants. This file (`AGENTS.md`) is the
**canonical, tool-agnostic source of truth**; each assistant's own instruction
file is a thin pointer back here so guidance never drifts. When adding durable
guidance, put it in `AGENTS.md` (or `docs/` for deep topics and link it) and
keep those pointer files thin. Per-app specifics belong in that app's
`AGENTS.md`.

Deeper guidance lives in [`docs/`](docs/) — scan the directory and read a doc's
intro to judge relevance. Two are not optional: read
[`docs/AI_GUARDRAILS.md`](docs/AI_GUARDRAILS.md) and
[`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md) before
security-, auth-, or reliability-sensitive work. Read the relevant
[`specs/`](specs/) file before feature work — specs are the source of truth for
**what** a feature does, who may do it, and how it's verified.

### Agent skills

Reusable agent skills (procedural runbooks in the
[Agent Skills](https://agentskills.io) `SKILL.md` format) live in
[`.agents/skills/`](.agents/skills/).

## Project Structure & Module Organization

- Deployable apps live in `apps/`, shared code in `packages/`, config in `tooling/`, and Turbo generators in `turbo/`.
- `packages/health/package.json` uses source-first entrypoints for monorepo workspace consumers and a `publishConfig` override for published `dist` artifacts. Do not remove `publishConfig` unless the workspace build orchestration guarantees `dist` artifacts exist before any consumer resolves the package.

## Environment Setup

- **Cross-platform:** All shell scripts use `#!/usr/bin/env bash` and are tested on **macOS** and **WSL 2** (Ubuntu). Windows developers must use WSL 2 — do not run scripts in native Windows shells (cmd, PowerShell). Never write macOS-only commands (`brew`, `open`, `launchctl`) or Windows-only paths without a Linux fallback.
- Node and pnpm are managed via NVM. The pnpm binary lives at `~/.nvm/versions/node/$(node --version)/bin/pnpm` under the currently active Node version. If `pnpm` is not on `PATH`, prepend that directory to `PATH` or run `. ~/.nvm/nvm.sh && nvm use` before running pnpm commands.
- The recommended local dev environment uses Docker. Run `pnpm local:setup` once after cloning; see [docs/LOCAL_DEV_DOCKER.md](docs/LOCAL_DEV_DOCKER.md) for setup instructions covering both macOS and WSL 2.

## Build, Test, and Development Commands

- **First-time setup:** `pnpm local:setup` — copies per-directory `.env` files, starts Docker services, runs migrations, and seeds the database. See [docs/LOCAL_DEV_DOCKER.md](docs/LOCAL_DEV_DOCKER.md) for the full guide.
- **Docker services:** `pnpm docker:up` to start (Postgres, Adminer, GCS emulator, Mailpit), `pnpm docker:down` to stop.
- Each app and `packages/env` has its own `.env` file (copied from `.env.example` by `pnpm local:setup`). Never commit `.env` files.
- Code quality: always run `pnpm lint:fix` and `pnpm format:fix` (for the whole repo — or filter to a certain app/package) to ensure your code passes all lint and formatting checks. Also run `pnpm typecheck` to validate types.
- `pnpm lint` does **not** cover dead-code detection: CI's `lint` job runs `pnpm lint` and `pnpm lint:unused` (knip) as two separate steps, so run `pnpm lint:unused` as well before pushing.
- `pnpm ci:local` chains the whole CI sequence (`format` → `lint` → `lint:unused` → `typecheck` → `build` → `test`) and is the closest local predictor of the CI gate.
- Database helpers: `pnpm db:pull`, `pnpm db:push`, and `pnpm reset-test-db`.
- Every other build/dev/test command is a standard Turborepo invocation — see the root `package.json` scripts.

## Coding Style & Naming Conventions

- Use Prettier (`@acme/prettier-config`) and ESLint (`@acme/eslint-config` base/next/react) as the source of truth.
- Name React components in PascalCase, prefix hooks with `use`, and use kebab-case for files/directories (e.g., `apps/map/src`).
- Co-locate feature-specific assets and tests near their sources (e.g., `apps/map/src/app/(feature)/`).

## Logging

- Never `console.*`. Use the `log*` helpers (`logTrace`…`logFatal`) from
  [`@acme/logger`](packages/logger/README.md), imported via the app's
  `lib/logging`. Reserve the raw `logger` for request-scoped children
  (`logger.child({ requestId })`).
- Signature is `(event, ctx, err)` — **`event` first**, unlike pino's native
  methods. `event` is a fixed dot-namespaced literal
  (`<area>.<feature>.<outcome>`, `snake_case` segments); per-occurrence data goes
  in `ctx`: `logError("api.rpc.handler_error", { orgId }, err)`.
- **Never log secrets or PII.**
- Details: [`docs/LOGGING.md`](docs/LOGGING.md) (primer, `LOG_LEVEL`, event
  naming), [`packages/logger/README.md`](packages/logger/README.md) (API
  reference), [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data)
  (what counts as sensitive).

## GitHub Actions Conventions

- **Pin third-party actions to a full commit SHA with a version comment** (e.g. `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`). SHAs are immutable — a semver tag can be force-pushed, a SHA cannot. Renovate (`pinDigests: true`) keeps the SHAs up to date automatically.
- Drive the Node version from `.nvmrc` via `actions/setup-node` (`node-version-file: .nvmrc`) — `.nvmrc` is the single source of truth. Never hardcode `node-version:` in a workflow.
- **Set the Docker target platform at build time, not in the `Dockerfile`.** Cloud Run only runs `linux/amd64`. The app `Dockerfile` `FROM` lines must **not** pin `--platform` (BuildKit's `FromPlatformFlagConstDisallowed` lint, and it forces emulation on arm64 dev machines). Instead pass the platform at the build invocation: `platforms: linux/amd64` on `docker/build-push-action` (CI) and `--platform=linux/amd64` on `docker build` (deploy). Building a **deployable** image locally on Apple Silicon therefore requires an explicit `docker build --platform=linux/amd64 …`. Do **not** switch to `$BUILDPLATFORM` cross-builds — `sharp`'s native binaries are platform-specific and would break in the amd64 runtime.
- Share toolchain setup through the composite action [`.github/actions/setup`](.github/actions/setup/action.yml) (pnpm + Node + pnpm-store cache + frozen install) instead of repeating setup steps per job.
- The `main` branch ruleset's required status checks and `check-regexp` in the deploy workflows (`_deploy-cloudrun.yml`, `_deploy-cloudrun-job.yml`, `deploy-homepage.yml`) are two independently-maintained lists — renaming or adding a required check needs both updated by hand, and they can drift apart if only one is updated. The ruleset currently requires 8 checks (`format-check`, `lint`, `typecheck`, `build`, `test-coverage`, `security-audit`, `lint-title`, `db-schema-sync`); `check-regexp` waits on 7 of those. `lint-title` is deliberately excluded from the deploy gate — it only runs on `pull_request` (`pr-title.yml` has no `push` trigger), so it never produces a check-run on a commit reached via tag push, and waiting on one that will never exist would hang the gate rather than deploy.

## Testing Guidelines

- Use Vitest for unit and integration tests; name test files `*.test.ts[x]` and place under or near source code or in `__tests__`.
- Reset databases before any suite that mutates data (`pnpm reset-test-db` or `pnpm -C packages/db reset-test-db`).
- Prefer fixtures in `apps/map/tests` or `packages/*/__mocks__` instead of live service calls.
- **Coverage thresholds ratchet upward.** `vitest.config.ts` being rewritten by a
  test run is expected — commit it. Never set `thresholds.autoUpdate` to `false`
  or delete the key, and never lower a threshold to make a suite pass; add tests
  instead. Enforced in `pnpm lint` and `pre-commit`. How coverage is measured and
  why: [`docs/testing.md`](docs/testing.md).

### Driving auth-bounded flows in local dev

Apps that require sign-in (e.g. `apps/map`, `apps/me`) authenticate via `apps/auth`, which uses email-based MFA. **No real inbox is involved** — outbound mail is caught by Mailpit (`http://localhost:8025`, started by `pnpm docker:up`), and agents drive the full sign-in flow headlessly by reading the 6-digit code from its REST API.

The full recipe lives in [`apps/auth/AGENTS.md`](apps/auth/AGENTS.md). Assistants that scan nested `AGENTS.md` files pick it up on their own; Claude Code reaches it through the `@AGENTS.md` import in [`apps/auth/CLAUDE.md`](apps/auth/CLAUDE.md).

## Commit Message Convention

This repo enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint + Lefthook. Every commit message **must** follow:

```
<type>(<scope>): <subject>
```

**Scope is required.** The Lefthook `commit-msg` hook will reject commits that omit it or use an unrecognized scope.

### Types

Use standard Conventional Commit types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.

### Scopes

The allowed scopes are the `scope-enum` array in
[`commitlint.config.mjs`](commitlint.config.mjs) — read them there rather than
from a copy that can drift. **When adding a new workspace**, add its scope to
that array.

**Multiple scopes are allowed**, separated by a comma (`,`), a slash (`/`), or a
backslash — e.g. `feat(map,api): add beatdown filter`. Every scope in the list
must be in the enum; one unrecognized entry rejects the whole message.

**Choosing a scope:**

- Use the app or package the change primarily affects (e.g., `fix(db): correct migration`)
- Use several when a change genuinely spans workspaces: `refactor(ui,map): extract shared card`
- For dependency updates: `chore(deps): bump next to 15.1`
- For CI/GitHub Actions: `ci(ci): add deploy workflow`
- For root config, monorepo tooling, or multi-package changes: `chore(repo): update turbo pipeline`
- The `main` scope is reserved for Release Please's own release commits — never hand-write it.

How a commit type drives version bumps and changelogs — including the
non-obvious rule that Release Please attributes a commit by **which files it
changed, not by its scope** — is documented in
[`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md).

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
