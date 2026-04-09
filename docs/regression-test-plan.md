# Monorepo Regression Test Plan

## Purpose

This document defines a structured regression test plan for the f3-nation monorepo. Use it when:

- **Dependency upgrades** land (TypeScript, ESLint, Drizzle ORM, Next.js, etc.)
- **Cross-cutting backend changes** affect shared packages consumed by multiple apps
- **Pre-release verification** before tagging a new version of any app
- **Database migration changes** that touch `@acme/db` schema or Drizzle config

The plan is designed to be **delegated to app owners** so regression testing can run in parallel across the team.

---

## Quick Reference: Automated CI Gates

Every push already runs these via `.github/workflows/ci.yml`:

| Gate          | Command              | Scope                                                                 |
| ------------- | -------------------- | --------------------------------------------------------------------- |
| Format        | `pnpm format`        | All workspaces                                                        |
| Lint          | `pnpm lint`          | All workspaces (except `@acme/auth` excluded from typecheck)          |
| Typecheck     | `pnpm typecheck`     | All workspaces (except `@acme/auth`)                                  |
| Build         | `pnpm build`         | All apps + packages                                                   |
| Test          | `pnpm test`          | `packages/api`, `apps/api`, `apps/map`, `apps/me` (requires Postgres) |
| Test Coverage | `pnpm test:coverage` | Same as test, with coverage reporting                                 |

**If CI passes, the automated gates are green.** The sections below cover what CI does NOT catch.

---

## App-by-App Test Matrix

### 1. API (`apps/api`) -- Port 3001

**Owner:** TBD

**Deployment:** Vercel (main repo `vercel.json`) + Docker (`apps/api/Dockerfile`)
**Depends on:** `@acme/api`, `@acme/auth`, `@acme/db`, `@acme/env`, `@acme/shared`, `@acme/ui`, `@acme/validators`

#### Automated Checks

- [ ] `pnpm --filter f3-nation-api build` passes
- [ ] `pnpm --filter f3-nation-api lint` passes
- [ ] `pnpm --filter f3-nation-api typecheck` passes
- [ ] `pnpm --filter f3-nation-api test` passes (unit + integration via vitest)
- [ ] `pnpm --filter f3-nation-api test:e2e` passes (Playwright -- currently manual dispatch via `playwright.yml`)

#### Manual Smoke Tests

- [ ] API docs page loads (`/api/reference` -- Scalar OpenAPI viewer)
- [ ] `GET /api/ping` returns 200
- [ ] Map data endpoint returns valid GeoJSON (spot-check `/api/map/locations`)
- [ ] Authenticated endpoints return 401 without token, 200 with valid token
- [ ] Org hierarchy endpoints return correct tree structure
- [ ] Event/attendance CRUD operations work end-to-end
- [ ] Webhook event processing completes without errors (check logs)

#### Staging Verification

- [ ] Deploy to staging, confirm API responds at `https://staging.api.f3nation.com` (or Vercel preview)
- [ ] Run `pnpm --filter f3-nation-api test:e2e:staging` against staging environment

---

### 2. Map (`apps/map`) -- Port 3000

**Owner:** TBD

**Deployment:** Vercel + Docker (`apps/map/Dockerfile`)
**Depends on:** `@acme/api`, `@acme/auth`, `@acme/db`, `@acme/env`, `@acme/mail`, `@acme/shared`, `@acme/ui`, `@acme/validators`

#### Automated Checks

- [ ] `pnpm --filter f3-nation-map build` passes
- [ ] `pnpm --filter f3-nation-map lint` passes
- [ ] `pnpm --filter f3-nation-map typecheck` passes
- [ ] `pnpm --filter f3-nation-map test` passes (vitest)
- [ ] `pnpm --filter f3-nation-map test:e2e` passes (Playwright)

#### Manual Smoke Tests

- [ ] Map renders with Google Maps tiles loading correctly
- [ ] Location markers/clusters appear on the map at various zoom levels
- [ ] Clicking a marker opens location detail with correct data
- [ ] Search functionality returns results and pans/zooms the map
- [ ] Responsive layout works on mobile viewport (375px) and desktop (1440px)
- [ ] QR code generation works for location pages
- [ ] Deep-linking to a specific location (`/map?lat=...&lng=...`) works

#### Staging Verification

- [ ] Deploy to staging, confirm map loads at staging URL
- [ ] Run `pnpm --filter f3-nation-map test:e2e:staging` against staging environment

---

### 3. Auth (`apps/auth`) -- Port 3004

**Owner:** TBD

**Deployment:** Google Cloud Run via Docker (`apps/auth/Dockerfile`), tag-triggered (`auth@x.y.z`)
**Depends on:** `@acme/db`, `@acme/shared`
**Production URL:** `https://auth.f3nation.com`
**Staging URL:** `https://staging.auth.f3nation.com`

#### Automated Checks

- [ ] `pnpm --filter f3-auth build` passes
- [ ] `pnpm --filter f3-auth lint` passes
- [ ] Docker image builds successfully: `docker build --file apps/auth/Dockerfile .`

> Note: Auth is excluded from `pnpm typecheck` at the root level. Run `pnpm --filter f3-auth typecheck` separately if needed.

#### Manual Smoke Tests

- [ ] OAuth sign-in flow completes (Discord provider)
- [ ] Magic link / email sign-in flow sends email and completes login
- [ ] Session is created and persists across page refreshes
- [ ] Token refresh works (wait for token expiry or force-expire)
- [ ] Logout clears session completely
- [ ] OIDC/SSO client registration works (`add-client` script)
- [ ] Auth redirects work correctly for configured client apps (Map, API, Me)
- [ ] Error pages render for invalid OAuth state, expired links, etc.

#### Staging Verification

- [ ] Deploy to staging Cloud Run, confirm auth flow works at `https://staging.auth.f3nation.com`
- [ ] Verify Map and Me apps can authenticate against staging auth

---

### 4. Me (`apps/me`) -- Port 3003

**Owner:** TBD

**Deployment:** Google Cloud Run via Docker (`apps/me/Dockerfile`), tag-triggered (`me@x.y.z`)
**Depends on:** `@acme/sso`
**Production URL:** `https://me.f3nation.com`
**Staging URL:** `https://staging.me.f3nation.com`

#### Automated Checks

- [ ] `pnpm --filter f3-me build` passes
- [ ] `pnpm --filter f3-me lint` passes
- [ ] `pnpm --filter f3-me typecheck` passes
- [ ] `pnpm --filter f3-me test` passes (vitest -- hooks + API route tests)
- [ ] `pnpm --filter f3-me test:coverage` meets coverage threshold

#### Manual Smoke Tests

- [ ] SSO login redirects to auth and returns with valid session
- [ ] Profile page loads with correct user data
- [ ] Profile edit (name, email, F3 name) saves and persists
- [ ] Avatar upload works (image appears after upload, stored in GCS)
- [ ] Role assignment and removal works
- [ ] Position management (add/remove positions) works
- [ ] User search returns results
- [ ] Logout works and redirects to login

#### Staging Verification

- [ ] Deploy to staging Cloud Run, confirm app loads at `https://staging.me.f3nation.com`
- [ ] Verify SSO flow works end-to-end with staging auth

---

### 5. Shared Packages (`packages/*`)

**Owner:** TBD (whoever owns the cross-cutting change)

These packages have no standalone deployment but breaking changes cascade to all apps.

| Package            | Has Tests                   | Key Concern                                                 |
| ------------------ | --------------------------- | ----------------------------------------------------------- |
| `@acme/api`        | Yes (vitest, 18 test files) | Router contracts, query logic, org-chart, webhook events    |
| `@acme/auth`       | No                          | Auth config, session types, provider setup                  |
| `@acme/db`         | No (has migrations)         | Schema changes, Drizzle ORM compatibility, migration safety |
| `@acme/env`        | No                          | Environment variable validation (t3-env)                    |
| `@acme/mail`       | No                          | Email template rendering, SMTP config                       |
| `@acme/shared`     | No                          | Shared utilities, types, constants                          |
| `@acme/sso`        | No                          | SSO client, token validation (used by Me app)               |
| `@acme/ui`         | No                          | Shared UI components (Radix-based)                          |
| `@acme/validators` | No                          | Zod schemas shared across apps                              |

#### Automated Checks

- [ ] `pnpm --filter @acme/api test` passes (18 test files covering routers + shared logic)
- [ ] All packages typecheck: `pnpm typecheck`
- [ ] All packages lint: `pnpm lint`
- [ ] All packages build: `pnpm build`

#### Manual Checks for Schema/DB Changes

- [ ] `pnpm db:generate` produces expected migration output (or no diff if schema unchanged)
- [ ] Migration is safe to run on production (no destructive column drops, no full table rewrites)
- [ ] `pnpm db:migrate` succeeds against a test database
- [ ] Drizzle Studio (`pnpm db:studio`) connects and shows correct schema

---

## Delegation Model

### How to Run a Regression Cycle

1. **Coordinator** (whoever is merging the cross-cutting change) creates a GitHub Issue or PR comment with this checklist, assigning sections to app owners.

2. **Each app owner** runs their section independently:

   ```bash
   # Pull the branch
   git checkout <branch-name>
   pnpm install

   # Run automated checks for your app
   pnpm --filter <app-name> build
   pnpm --filter <app-name> lint
   pnpm --filter <app-name> typecheck
   pnpm --filter <app-name> test

   # Then do manual smoke tests from the checklist
   pnpm --filter <app-name> dev
   ```

3. **App owners report back** by checking off items in the PR/Issue and leaving a comment with any failures.

4. **Coordinator collects results** and gives the green light to merge.

### Shortcut: CI Covers the Basics

If CI is green on the PR, the following are already verified:

- format, lint, typecheck, build, test, test-coverage

App owners only need to focus on **manual smoke tests** and **staging verification**.

---

## Automation Opportunities

### Currently Automated (CI)

| What                   | How                            | Coverage                                                              |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Format                 | `pnpm format` via Turbo        | All workspaces                                                        |
| Lint                   | `pnpm lint` via Turbo          | All workspaces                                                        |
| Typecheck              | `pnpm typecheck` via Turbo     | All except `@acme/auth`                                               |
| Build                  | `pnpm build` via Turbo         | All apps + packages                                                   |
| Unit/Integration Tests | `pnpm test` via Turbo + Vitest | `packages/api` (18 files), `apps/api` (2 files), `apps/me` (16 files) |
| Test Coverage          | `pnpm test:coverage`           | Same scope as tests                                                   |

### Playwright E2E (Partially Automated)

- **Config exists** for `apps/api` and `apps/map` (both local and staging configs)
- **CI workflow exists** (`.github/workflows/playwright.yml`) but is **manual dispatch only** (`workflow_dispatch`)
- **No e2e test files found** -- the Playwright configs are set up but tests have not been written yet
- **Opportunity:** Write Playwright tests for critical paths (map rendering, API endpoint smoke tests) and add them to CI on PRs targeting `dev` or `main`

### Claude Code Skills

These skills can automate portions of the regression cycle:

| Skill                     | What It Does                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/f3:qa`                  | Autonomous QA testing -- synthesizes test plans from PR context, executes via browser automation, auto-judges pass/fail |
| `/pst:qa`                 | Same capability, alternative namespace                                                                                  |
| `/validate-quality-gates` | Runs build, lint, typecheck, test, test:coverage until all pass, fixing issues as found                                 |
| `/f3:code-review`         | Code review with worktree-isolated fix verification                                                                     |
| `/f3:sweep`               | Parallel quality sweep across open PRs                                                                                  |

**Recommended workflow for dependency upgrades:**

1. Open the dependency upgrade PR
2. Run `/validate-quality-gates` to fix any automated breakage
3. Run `/f3:qa` to generate and execute a smoke test plan
4. Delegate manual verification to app owners using this document

### API Contract Testing

- The API app uses oRPC with Zod schemas (`@orpc/zod`, `@orpc/openapi`) which provides runtime type validation
- **Opportunity:** Export the OpenAPI spec from the oRPC router and add a CI step that validates the spec hasn't changed unexpectedly (breaking change detection)
- **Opportunity:** Use the Scalar API reference (`@scalar/nextjs-api-reference`) to generate contract tests

### Database Migration Safety

- Drizzle ORM handles schema generation and migrations (`packages/db`)
- **Opportunity:** Add a CI check that runs `pnpm db:generate` and verifies no unexpected migration diff is produced on PRs that don't touch `packages/db`
- **Opportunity:** Add a migration safety linter that warns on destructive operations (column drops, type changes)

---

## Checklist Template for PR Description

Copy this into a PR description or issue body when running a regression cycle:

```markdown
## Regression Test Checklist

**Triggered by:** [describe the change, e.g., "TypeScript 5.x upgrade (#233)"]
**Coordinator:** @username

### CI Gates (automated)

- [ ] format-check
- [ ] lint
- [ ] typecheck
- [ ] build
- [ ] test
- [ ] test-coverage

### API (`apps/api`) -- Owner: @TBD

- [ ] Automated checks pass (build/lint/typecheck/test)
- [ ] API docs page loads
- [ ] Ping endpoint returns 200
- [ ] Map data endpoints return valid responses
- [ ] Auth-gated endpoints enforce auth correctly
- [ ] Staging deploy + smoke test

### Map (`apps/map`) -- Owner: @TBD

- [ ] Automated checks pass (build/lint/typecheck/test)
- [ ] Map renders with markers/clusters
- [ ] Search works
- [ ] Location detail opens correctly
- [ ] Mobile responsive layout works
- [ ] Staging deploy + smoke test

### Auth (`apps/auth`) -- Owner: @TBD

- [ ] Automated checks pass (build/lint)
- [ ] OAuth sign-in flow works
- [ ] Email/magic-link sign-in works
- [ ] Session persistence + token refresh
- [ ] Logout clears session
- [ ] Staging deploy + smoke test

### Me (`apps/me`) -- Owner: @TBD

- [ ] Automated checks pass (build/lint/typecheck/test)
- [ ] SSO login works
- [ ] Profile CRUD works
- [ ] Avatar upload works
- [ ] Role/position management works
- [ ] Staging deploy + smoke test

### Shared Packages -- Owner: @TBD

- [ ] `@acme/api` tests pass
- [ ] All packages typecheck
- [ ] No unexpected migration diff from `pnpm db:generate`
- [ ] Drizzle Studio connects correctly
```
