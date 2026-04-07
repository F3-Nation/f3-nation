# Copilot Instructions for F3 Nation Monorepo

> This file provides context to GitHub Copilot (Chat, Edits, Agent) across the workspace.
> It supplements `AGENTS.md` at the repo root — read that file for full architecture details.

## Quick Reference

- **Monorepo**: pnpm 8.15.1 + Turborepo. Node >=20.19.
- **Apps**: `apps/map` (Next.js 15, port 3000), `apps/api` (oRPC API, port 3001), `apps/auth`, `apps/me`.
- **Packages**: `@acme/api`, `@acme/auth`, `@acme/db`, `@acme/ui`, `@acme/validators`, `@acme/shared`, `@acme/env`, `@acme/mail`.

## Critical Conventions

1. **oRPC, not tRPC**: The API layer uses `@orpc/server`. Never import from `@trpc/*`.
2. **Drizzle, not Prisma**: Database uses Drizzle ORM with PostgreSQL. Schema in `packages/db/src/schema/`.
3. **shadcn/ui components**: UI primitives live in `packages/ui/src/`. Use existing components before creating new ones.
4. **Zod validation via drizzle-zod**: Generate base schemas with `createInsertSchema`/`createSelectSchema`, then extend.
5. **Org hierarchy matters**: Nation → Sector → Region → AO. Permission checks cascade up the tree via `checkHasRoleOnOrg()`.
6. **Environment validation**: Use `@t3-oss/env-nextjs` — don't access `process.env` directly in app code.

## Style Rules

- TypeScript strict mode. Prefer `import type` for type-only imports.
- kebab-case files, PascalCase components, `use` prefix hooks, UPPER_SNAKE_CASE constants, snake_case DB columns.
- Two-space indentation. Prettier + ESLint are the formatters of record.
- Prefix unused variables with `_`.

## Before Committing AI-Generated Code

```bash
pnpm lint && pnpm format && pnpm typecheck && pnpm test
```

## Common Gotchas

- `@acme/api` routers use `os.prefix()` pattern — look at existing routers before creating new ones.
- Auth cookies differ by environment (production: `__Secure-` prefix, `.f3nation.com`; dev: `.f3nation.test`).
- DB client uses a global singleton in dev to prevent multiple instances — don't create new db clients.
- Test database must be reset before suites that mutate data: `pnpm reset-test-db`.
