# Repository Guidelines

## Project Structure & Module Organization
- PNPM + Turborepo monorepo (Node >=20.19.0). Root holds shared configs (`turbo.json`, `vercel.json`, `cloudbuild*.yaml`, `tooling/`).
- Apps live in `apps/`; `apps/map/` (Next.js 14, port 3000) with unit tests in `__tests__/` and Playwright flows in `tests/`.
- Shared packages in `packages/` (api, auth, db, env, shared, ui, validators) cover backend routes, auth, schema, env validation, utilities, UI, and shared zod schemas.

## Build, Test, and Development Commands
- `pnpm install` to sync dependencies (use `--filter <workspace>` to scope).
- `pnpm dev --filter f3-nation-map` starts the map app locally with env loaded.
- `pnpm build` or `pnpm build --filter …` runs workspace builds via Turbo.
- `pnpm lint`/`pnpm lint:fix` (ESLint), `pnpm format:fix` (Prettier), `pnpm typecheck` (TS noEmit).
- `pnpm test --filter f3-nation-map` runs the map Vitest suite; inside `apps/map` use `pnpm test:unit` or `pnpm test:e2e` (plus `test:e2e:debug`/`ui` for debugging). `pnpm reset-test-db` refreshes the test DB when needed.
- Database helpers: `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:studio` target the Drizzle schema.

## Coding Style & Naming Conventions
- TypeScript-first; follow ESLint/Prettier configs (2-space indent, trailing commas). Let formatters handle spacing/imports.
- React components PascalCase; hooks prefixed `use`; filenames and route segments lowercase/kebab-case (e.g., `global-error.tsx`, `_components/` for internals).
- Keep shared logic in `packages/shared` or `packages/ui`; avoid duplicating utilities inside apps.

## Testing Guidelines
- Prefer Vitest for unit/integration work; place specs near code in `__tests__/` and suffix with `.spec.tsx`. Reuse `apps/map/__tests__/setup.tsx` for React tests.
- Write Playwright journeys in `apps/map/tests/*.spec.ts`; keep flows idempotent and seed data via scripts instead of hardcoded credentials. Update mocks/MSW handlers alongside code changes and cover error/empty states.

## Commit & Pull Request Guidelines
- Follow the conventional-style messages used here (`feat: …`, `tidy: …`, `fix: …`); present tense, scoped and concise.
- PRs should include a short summary, linked issue/ticket, screenshots for UI changes, and a list of commands run (lint, typecheck, Vitest, Playwright). Note any env or DB migration impacts.
- Keep PRs focused on a single concern; prefer small, reviewable diffs.

## Environment & Security Notes
- Env files are per app (e.g., `apps/map/.env` from the shared `env.zip`); never commit secrets. Use `pnpm with-env` or app scripts to load variables.
- Apply least-privilege for API keys; rotate credentials via your secret manager, not in code.
- Validate new env vars through `packages/env` schemas to keep runtime checks consistent.
