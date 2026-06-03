# Repository Guidelines

## Project Structure & Module Organization

- Use Node >=24.14 (see `.nvmrc`), pnpm 10, and Turborepo for workspace orchestration.
- The `apps/map` directory contains the Next.js 15 map UI (port 3000).
- Shared code is organized in `packages/`: `api` (tRPC routers), `auth` (auth helpers), `db` (Drizzle schema/migrations), `ui` (shared components), `validators` (Zod schemas), and `shared` (utilities).
- Configuration files are in `tooling/`; pnpm patches go in `patches/`; Turbo generators live in `turbo/`.

## Environment Setup

- **Cross-platform:** All shell scripts use `#!/usr/bin/env bash` and are tested on **macOS** and **WSL 2** (Ubuntu). Windows developers must use WSL 2 — do not run scripts in native Windows shells (cmd, PowerShell). Never write macOS-only commands (`brew`, `open`, `launchctl`) or Windows-only paths without a Linux fallback.
- Node and pnpm are managed via NVM. The pnpm binary lives at `~/.nvm/versions/node/$(node --version)/bin/pnpm` under the currently active Node version. If `pnpm` is not on `PATH`, prepend that directory to `PATH` or run `. ~/.nvm/nvm.sh && nvm use` before running pnpm commands.
- The recommended local dev environment uses Docker. Run `pnpm local:setup` once after cloning; see [docs/LOCAL_DEV_DOCKER.md](docs/LOCAL_DEV_DOCKER.md) for setup instructions covering both macOS and WSL 2.

## Build, Test, and Development Commands

- **First-time setup:** `pnpm local:setup` — copies per-directory `.env` files, starts Docker services, runs migrations, and seeds the database. See [docs/LOCAL_DEV_DOCKER.md](docs/LOCAL_DEV_DOCKER.md) for the full guide.
- **Docker services:** `pnpm docker:up` to start (Postgres, Adminer, GCS emulator, Mailpit), `pnpm docker:down` to stop.
- Install dependencies with `pnpm install`. You can scope installations with `--filter <workspace>`.
- Start development: `pnpm dev --filter f3-map` for the map app, or `pnpm dev` to run all watch tasks.
- Each app and `packages/env` has its own `.env` file (copied from `.env.local.example` by `pnpm local:setup`). Never commit `.env` files.
- Build with `pnpm build` (or `pnpm build --filter apps/map`), and start production with `pnpm -C apps/map start`.
- Code quality: always run `pnpm lint` (or `pnpm lint --filter apps/map`) and `pnpm format:fix` to ensure your code passes all lint and formatting checks. Also run `pnpm typecheck` to validate types.
- Testing:
  - Run all tests with `pnpm test` (via the Turbo pipeline).
  - Run targeted tests: `pnpm -C apps/map test`, `pnpm -C apps/map test:e2e`.
  - Database helpers: `pnpm db:pull`, `pnpm db:push`, and `pnpm reset-test-db`.

## Coding Style & Naming Conventions

- Use Prettier (`@acme/prettier-config`) and ESLint (`@acme/eslint-config` base/next/react) as the source of truth.
- Always autofix issues with `pnpm lint:fix` and confirm changes with `pnpm lint` and `pnpm format` before committing.
- Code should use two-space indentation by default.
- Prioritize TypeScript; use `.ts`/`.tsx` with explicit typings.
- Name React components in PascalCase, prefix hooks with `use`, and use kebab-case for files/directories (e.g., `apps/map/src`).
- Co-locate feature-specific assets and tests near their sources (e.g., `apps/map/src/app/(feature)/`).

## Testing Guidelines

- Use Vitest for unit and integration tests; name test files `*.test.ts[x]` and place under or near source code or in `__tests__`.
- Use Playwright for e2e in `apps/map`; generate reports via `pnpm -C apps/map test:e2e:report`.
- Reset databases before any suite that mutates data (`pnpm reset-test-db` or `pnpm -C packages/db reset-test-db`).
- Prefer fixtures in `apps/map/tests` or `packages/*/__mocks__` instead of live service calls.

### Driving auth-bounded flows in local dev

Apps that require sign-in (apps/map, apps/me, pax-vault, the-codex, ...) authenticate via `apps/auth`, which uses email-based MFA. **No real inbox is involved.** In local development, outbound email is captured by one of two backends depending on your setup:

- **Docker setup (recommended):** Mailpit captures all mail at `http://localhost:8025`. Read MFA codes from the Mailpit web UI or its REST API.
- **Non-Docker / GCP setup:** The auth server routes mail through [Ethereal](https://ethereal.email/) and emits a public preview URL to its stdout.

AI agents and CI scripts drive the full sign-in flow by pulling the 6-digit code from the active mail backend and POSTing it to NextAuth's standard `/api/auth/callback/credentials` endpoint with a CSRF token (helper: `scripts/qa/extract-mfa-link.sh --code`). The `/api/verify-email` rate limit is bypassed in non-production environments to keep this viable for parallel agent QA.

Start here:

- [`apps/auth/AGENTS.md`](apps/auth/AGENTS.md) -- agent-focused recipe and error modes
- [`docs/QA_LOCAL_AUTH.md`](docs/QA_LOCAL_AUTH.md) -- cookbook for headless and browser-driven flows
- [`apps/auth/README.md` § Local QA / Email Preview](apps/auth/README.md#local-qa--email-preview) -- prose overview

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

| Category        | Scopes                                                            |
| --------------- | ----------------------------------------------------------------- |
| Apps            | `map`                                                             |
| Apps & Packages | `api`, `auth` (exist in both `apps/` and `packages/`)             |
| Packages        | `db`, `env`, `mail`, `shared`, `sso`, `ui`, `validators`          |
| Tooling         | `eslint`, `prettier`, `tsconfig`, `scripts`, `github`, `tailwind` |
| Cross-cutting   | `deps`, `ci`, `repo`, `release`, `dev` (used by Release Please)   |

**Choosing a scope:**

- Use the app or package the change primarily affects (e.g., `fix(db): correct migration`)
- For dependency updates: `chore(deps): bump next to 15.1`
- For CI/GitHub Actions: `ci(ci): add deploy workflow`
- For root config, monorepo tooling, or multi-package changes: `chore(repo): update turbo pipeline`
- For release-related changes: `chore(release): v3.10.0`

**When adding a new workspace**, add its scope to the array in `commitlint.config.mjs`.

### Examples

```
feat(map): add workout detail modal
fix(auth): handle expired refresh tokens
chore(deps): bump drizzle-orm to 0.35
refactor(api): extract pagination into shared helper
test(validators): add edge cases for date parsing
docs(repo): update AGENTS.md with commit conventions
ci(ci): add preview deploy for map app
chore(repo): configure turborepo remote caching
```

## Pull Request Guidelines

- Every pull request should:
  - Include a clear summary, any related issue(s), commands run, and impact to DB/env.
  - Add screenshots or screen recordings for UI changes in `apps/map`.
  - Highlight any new migrations or environment variables.
  - Never include secrets; share them using Slack or Doppler scripts, not via git.
- Before opening a pull request, ensure both `pnpm lint` and `pnpm format` pass with no errors or changes required.

## Security & Environment

- Store all secrets in per-directory `.env` files (one per app and `packages/env`). Always use `with-env` helpers to load environment variables and never commit `.env` files to the repo.
- Scope Sentry/analytics keys per environment and rotate if leaked. Run production DB changes only through scripts in `packages/db`.
