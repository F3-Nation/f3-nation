# Repository Guidelines

> **For AI assistants**: This file is the single source of truth for understanding the F3 Nation monorepo.
> It is consumed by GitHub Copilot, Claude (AGENTS.md = CLAUDE.md equivalent), Cursor, and other AI tools.
> Keep it accurate — when conventions change, update this file.

## Project Overview

F3 Nation is a volunteer-run fitness and leadership community. This monorepo powers the public-facing map application, admin tools, and backend APIs. The codebase is maintained by amateur, volunteer developers who rely heavily on AI tooling. Code quality gates (lint, format, typecheck, test) are enforced in CI and must pass before merge.

## Project Structure & Module Organization

- **Runtime**: Node >=20.19 (see `.nvmrc`), pnpm 8.15.1, Turborepo for workspace orchestration.
- **Apps** (`apps/`):
  - `apps/map` — Next.js 15 App Router, the public map UI (port 3000). Standalone output for Docker.
  - `apps/api` — Next.js API host exposing oRPC routes (port 3001). Has OpenAPI/Swagger docs at `/docs`.
- **Packages** (`packages/`):
  - `@acme/api` — oRPC routers (NOT tRPC). Organized by domain: user, event, org, location, attendance, etc.
  - `@acme/auth` — NextAuth v5 config. Email/OTP/Credentials providers. Custom Drizzle adapter. Cross-subdomain cookies.
  - `@acme/db` — Drizzle ORM schema and migrations for PostgreSQL. Global singleton client in dev.
  - `@acme/ui` — 30+ shadcn/ui components. HSL CSS variable theming. Tailwind + `tailwindcss-animate`.
  - `@acme/validators` — Zod schemas, many generated from Drizzle via `drizzle-zod` then extended with business logic.
  - `@acme/shared` — Shared types, enums (DayOfWeek, EventCadence, UserRole, etc.), utility functions, React hooks.
  - `@acme/env` — Environment variable validation via `@t3-oss/env-nextjs`.
  - `@acme/mail` — Email service integration.
- **Tooling** (`tooling/`): ESLint, Prettier, Tailwind, TypeScript configs, release-it, Doppler scripts.
- **Turbo generators**: `turbo/generators/` for scaffolding new packages.

## Domain Model (Key Concepts)

Understanding the domain is critical for working in this codebase:

- **Org Hierarchy**: Nation → Sector → Region → AO. Permissions cascade up this tree.
- **Events**: Recurring workouts with `events` (template) and `eventInstances` (single occurrence). Events have types, tags, and cadence.
- **Users & Roles**: Users have roles scoped to orgs (`rolesXUsersXOrg`). Roles: `user`, `editor`, `admin`. Admin at a Region level implies admin for all AOs under it.
- **Attendance**: Tracks who attended which event instances. Multiple attendance types supported.
- **Locations**: Physical locations tied to orgs/events with lat/lng. Google Places integration.

## API Architecture

- **Framework**: oRPC (Open RPC) — NOT tRPC. Import from `@orpc/server`.
- **Router pattern**: `os.prefix(API_PREFIX_V1).router({ ... })` with nested domain prefixes.
- **Context**: `{ session: Session | null; db: AppDb }`.
- **Authorization levels**: `base` (public), `editorProcedure` (editors+), `adminProcedure` (admins only).
- **Permission checking**: `checkHasRoleOnOrg()` walks the org hierarchy. `getEditableOrgIds()` returns orgs a user can modify.
- **Rate limiting**: In-memory `MemoryRatelimiter` (200 req/min prod, 10k dev).
- **Pagination**: Standardized via `withPagination()` helper.
- **Webhooks**: `notifyMapDataChange()` for cache invalidation.

## Build, Test, and Development Commands

| Command                           | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `pnpm install`                    | Install all dependencies                                  |
| `pnpm dev`                        | Start all apps in watch mode (parallel)                   |
| `pnpm dev --filter f3-nation-map` | Start only the map app                                    |
| `pnpm build`                      | Build all workspaces (Turbo-cached)                       |
| `pnpm lint`                       | ESLint across monorepo                                    |
| `pnpm lint:fix`                   | Auto-fix lint issues                                      |
| `pnpm format`                     | Check Prettier formatting                                 |
| `pnpm format:fix`                 | Auto-format all files                                     |
| `pnpm typecheck`                  | TypeScript type checking                                  |
| `pnpm test`                       | Run all Vitest tests                                      |
| `pnpm -C apps/map test`           | Run map app tests only                                    |
| `pnpm -C apps/map test:e2e`       | Playwright e2e tests                                      |
| `pnpm db:push`                    | Sync Drizzle schema → DB                                  |
| `pnpm db:pull`                    | Introspect DB → schema                                    |
| `pnpm db:generate`                | Generate migration files                                  |
| `pnpm db:migrate`                 | Run pending migrations                                    |
| `pnpm db:seed`                    | Seed database                                             |
| `pnpm reset-test-db`              | Reset test database                                       |
| `pnpm ci:local`                   | Full CI locally: format → lint → typecheck → build → test |

**Environment**: A populated root `.env` file is required. Use `with-env` helpers to load it. Never commit `.env`.

## Coding Style & Naming Conventions

- **Source of truth**: Prettier (`@acme/prettier-config`) and ESLint (`@acme/eslint-config` base/next/react).
- **Indentation**: Two spaces.
- **Language**: TypeScript everywhere. Use `.ts`/`.tsx` with explicit typings.
- **File/directory naming**: kebab-case (e.g., `event-instance.ts`, `check-has-role.ts`).
- **React components**: PascalCase (e.g., `MapView`, `EventCard`).
- **Hooks**: `use` prefix (e.g., `useUserLocation`, `useKeyPress`).
- **Database columns**: snake_case (Drizzle convention).
- **Constants**: UPPER_SNAKE_CASE (e.g., `API_PREFIX_V1`).
- **Unused variables**: Prefix with `_` to satisfy ESLint.
- **Imports**: Use `@acme/*` workspace aliases. Prefer `import type` for type-only imports.
- **Co-location**: Keep feature-specific assets, tests, and components near their source.

## Validation Patterns

- Generate base schemas from Drizzle tables via `createInsertSchema` / `createSelectSchema` from `drizzle-zod`.
- Extend with business logic using `.pick()`, `.omit()`, `.extend()`, `.superRefine()`.
- Time format: `^\d{4}$` (HHmm, e.g., "0530").
- Social URLs: Custom `socialUrlSchema` with protocol auto-detection.
- Email: Normalized with `normalizeEmail()` utility.

## Frontend Patterns (apps/map)

- **Framework**: Next.js 15 App Router with server components by default.
- **Provider stack** (root layout): `DataProvider` → `SessionProvider` → `OrpcReactProvider` → `UserLocationProvider` → `KeyPressProvider` → `ThemeProvider` → `TooltipProvider`.
- **Styling**: Tailwind CSS with shadcn/ui. CVA for component variants. `cn()` utility for class merging.
- **Fonts**: GeistSans / GeistMono from `geist/font`.
- **Error tracking**: Sentry (edge + server configs).
- **Environment validation**: `@t3-oss/env-nextjs` with Zod at build time.
- **API client**: oRPC React provider with SSR-optimized pre-rendering.

## Testing Guidelines

- **Unit/Integration**: Vitest. Name test files `*.test.ts[x]`. Place under or near source, or in `__tests__/`.
- **E2E**: Playwright for `apps/map`. Reports via `pnpm -C apps/map test:e2e:report`.
- **Database**: Reset before suites that mutate data (`pnpm reset-test-db`).
- **Fixtures**: Prefer fixtures in `apps/map/tests` or `packages/*/__mocks__` over live service calls.
- **CI environment**: PostgreSQL service on port 5432, mocked OAuth/Google/email services.

## Commit & Pull Request Guidelines

- Write concise, imperative commit subjects (e.g., `Add admin db reset script`). No trailing punctuation.
- Every pull request must:
  - Include a clear TL;DR summary, related issue(s), and testing instructions.
  - Add screenshots/recordings for UI changes.
  - Highlight new migrations, environment variables, or breaking changes.
  - Never include secrets.
- Before opening a PR: `pnpm lint && pnpm format && pnpm typecheck` must pass.

## Security & Environment

- All secrets in root `.env`. Use `with-env` helpers. Never commit `.env` files.
- Scope Sentry/analytics keys per environment. Rotate if leaked.
- Production DB changes only through scripts in `packages/db`.
- Auth cookies: `__Secure-` prefix in production, `.f3nation.com` domain.
- Rate limiting on all public API routes.

## AI-Specific Guidelines

When using AI to generate or modify code in this repo:

1. **Always verify output**: Run `pnpm lint && pnpm format && pnpm typecheck` before committing AI-generated code.
2. **Respect the architecture**: Use oRPC (not tRPC), Drizzle (not Prisma), shadcn/ui components (not custom UI from scratch).
3. **Environment variables**: Access via `@t3-oss/env-nextjs` (see `apps/*/src/env.ts`), never raw `process.env` in app code.
4. **Test what you generate**: Add or update tests for any new logic. Run `pnpm test` to verify.
5. **Don't invent patterns**: Follow existing patterns in nearby files. When unsure, look at similar routers/components.
6. **Schema changes need migrations**: Never modify DB schema without generating a migration (`pnpm db:generate`).
7. **Permissions matter**: New API endpoints must use the appropriate auth procedure and check org-level permissions.
8. **Keep packages focused**: Don't add app-specific logic to shared packages. Don't add shared logic only one app uses.
9. **Don't add dependencies without discussion**: Prefer existing packages in the monorepo before introducing new ones.
