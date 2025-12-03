# Repository Guidelines

## Project Structure & Module Organization

- Node >=20.19 (`.nvmrc`), pnpm 8.15.1, and Turborepo orchestrate work.
- `apps/map` is the Next.js 15 map UI (port 3000); `apps/admin` holds database utilities, seeds, and migration helpers.
- Shared code lives in `packages/`: `api` (tRPC routers), `auth` (auth helpers), `db` (Drizzle schema/migrations), `ui` (shared components), `validators` (Zod schemas), and `shared` (utilities). Config lives in `tooling/`, pnpm patches in `patches/`, and Turbo generators in `turbo/`.

## Build, Test, and Development Commands

- Install: `pnpm install`; scope with `--filter <workspace>` when possible.
- Develop: `pnpm dev --filter f3-nation-map` starts the map app; `pnpm dev` runs all watch tasks. Keep a populated root `.env` for `with-env` scripts.
- Build: `pnpm build` or `pnpm build --filter apps/map`; start prod with `pnpm -C apps/map start`.
- Quality: `pnpm lint` (or `pnpm lint --filter apps/map`), `pnpm format:fix`, `pnpm typecheck`.
- Tests: `pnpm test` runs the Turbo pipeline. Targeted: `pnpm -C apps/map test`, `pnpm -C apps/map test:e2e`, `pnpm -C apps/admin test`. Database helpers: `pnpm db:pull`, `pnpm db:push`, `pnpm reset-test-db`.

## Coding Style & Naming Conventions

- Prettier (`@acme/prettier-config`) and ESLint (`@acme/eslint-config` base/next/react) are authoritative; autofix with `pnpm lint:fix`. Default formatting uses two-space indentation.
- TypeScript-first; favor `.ts/.tsx` and explicit types.
- React components in PascalCase; hooks prefixed with `use`; directories/files generally kebab-case as in `apps/map/src`.
- Co-locate feature assets and tests near sources (e.g., `apps/map/src/app/(feature)/`).

## Testing Guidelines

- Vitest drives unit/integration in map and admin; name tests `*.test.ts[x]` under code or `__tests__`.
- Playwright handles e2e in `apps/map`; reports via `pnpm -C apps/map test:e2e:report`.
- Reset DBs before suites that touch data (`pnpm reset-test-db` or `pnpm -C packages/db reset-test-db`); favor fixtures in `apps/map/tests` or `packages/*/__mocks__` over live services.

## Commit & Pull Request Guidelines

- Use concise, imperative subjects (e.g., `Add admin db reset script`), no trailing punctuation.
- PRs should include a summary, linked issue, commands run, and DB/env impact. Add screenshots or clips for UI changes in `apps/map`.
- Call out migrations or new environment variables; share secrets via Slack/Doppler scripts, never in Git.

## Security & Environment

- Secrets live in a root `.env`; `with-env` helpers load it. Never commit env files.
- Scope Sentry/analytics keys per environment and rotate if leaked; keep production DB changes behind scripts in `apps/admin` and `packages/db`.
