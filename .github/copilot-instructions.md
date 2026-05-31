# GitHub Copilot Instructions

This repository uses the **`AGENTS.md` standard** as the single source of truth
for AI coding guidance. Before making changes, read:

1. [`AGENTS.md`](../AGENTS.md) — canonical repository conventions (structure,
   build & test commands, environment setup, coding style, commit conventions).
2. [`docs/AI_DEVELOPMENT_GUIDE.md`](../docs/AI_DEVELOPMENT_GUIDE.md) — secure
   patterns and pitfalls to avoid, plus a pre-flight checklist for every change.
3. The relevant per-app guide, e.g. [`apps/me/AGENTS.md`](../apps/me/AGENTS.md)
   or [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md).

If asked to **audit** the repo and file issues, follow
[`docs/AI_AUDIT_PLAYBOOK.md`](../docs/AI_AUDIT_PLAYBOOK.md).

## Non-negotiables (see the development guide for detail)

- **Authorize every endpoint, not just authenticate it.** `protectedProcedure`
  only proves a user is logged in — it does not authorize the resource. Never act
  on a `userId`/`orgId`/`eventId` from the request body without scoping to the
  session subject or checking a role on the target (`checkHasRoleOnOrg`).
- **CSPRNG for all credentials/OTPs/tokens** — never `Math.random()`.
- **Never log or bake in secrets or PII** (stdout, Docker layers, fixtures, the
  repo).
- **Verify JWTs (signature + issuer + audience), don't just decode them.**
- **`NEXT_PUBLIC_*` is public** — it ships in the browser bundle; it must not
  grant server privileges.
- **Assume multi-instance** — no in-memory rate limiters/locks/caches as the
  source of truth in production.
- **Validate external input with Zod; parameterize all SQL.**
- **Set HTTP security headers; sanitize untrusted HTML; bound and type-check
  uploads server-side.**

## Conventions

- Node ≥ 24.14, pnpm 10, Turborepo. TypeScript with explicit types. Prettier +
  ESLint are authoritative. kebab-case files, PascalCase components,
  `use`-prefixed hooks.
- Commits: Conventional Commits with a **required scope** (`<type>(<scope>):
<subject>`), enforced by commitlint. Scopes are defined in
  `commitlint.config.mjs`.
- Before a PR: `pnpm lint`, `pnpm format`, `pnpm typecheck`, and relevant
  `pnpm test` must pass.
- Make the smallest correct change — match existing patterns, no unrequested
  refactors, comments, or abstractions.

Keep this file thin; durable guidance belongs in `AGENTS.md` / `docs/`.
