# @acme/redirect-admin

Self-serve admin UI for F3 region custom domain registration and lifecycle management.

Part of the R5 redirect platform refactor — see
`f3-redirect/docs/plans/2026-04-14-multi-tenant-saas-refactor.md`, Decisions 5–8
and 11.

## What this app does

Region admins (`admin` or `editor` role on an F3 org) can:

1. Sign in via F3 SSO (copied from `apps/me`).
2. See their orgs and current binding state (`no_binding` → bind button,
   `unverified` → stub for F3R5_013, `verified` → domain list + register).
3. Register a custom hostname (apex or stats subdomain) for a verified-binding
   org. The POST handler
   - checks the domain blocklist,
   - enforces per-org quota (`org_domain_quota.max_domains`, default 10),
   - inserts a row into `region_custom_domains` with
     `lifecycle_state = 'pending'`. The `trg_rcd_verified_binding` trigger in
     `packages/redirect-platform-db/sql/0002_*.sql` enforces at the DB level
     that the org's binding is `verified`.
   - calls Certificate Manager `DnsAuthorization.Create` with the
     deterministic id `dns-auth-<row.id>`, handling `ALREADY_EXISTS` by
     GET-and-reuse (same pattern as the reconciler).
   - surfaces the CNAME challenge record the user needs to add to their DNS.
4. Poll domain status (`GET /api/domains/:id`) and see a user-friendly
   rendering via `state-presenter.ts`.
5. Tombstone a domain (`DELETE /api/domains/:id`) — the reconciler owns the
   actual GCP teardown.

## Architecture

```
apps/redirect-admin/
├── middleware.ts             # SSO gate (session cookie signature check)
├── src/
│   ├── env.ts                # env validation; throws on missing required vars
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx          # landing: orgs + binding state
│   │   ├── domains/
│   │   │   ├── page.tsx      # all domains across user's orgs
│   │   │   └── new/page.tsx  # registration form
│   │   └── api/
│   │       ├── auth/…        # SSO routes copied from apps/me
│   │       └── domains/
│   │           ├── register/route.ts   # POST handler — thin wrapper
│   │           └── [id]/route.ts       # GET status, DELETE tombstone
│   ├── components/
│   │   └── register-domain-form.tsx    # client component
│   └── lib/
│       ├── auth/…                      # SSO helpers (copied from apps/me)
│       ├── supabase-client.ts          # read-only Drizzle over @acme/db
│       ├── db-client.ts                # Drizzle over @acme/redirect-platform-db
│       ├── cert-manager-client.ts      # @google-cloud/certificate-manager wrapper
│       ├── validator-client.ts         # calls the internal region-binding validator
│       ├── quota-check.ts              # pure per-org quota check
│       ├── hostname-validation.ts      # pure syntactic hostname validation
│       ├── state-presenter.ts          # pure lifecycle → view model
│       └── services/
│           ├── domain-registration.ts  # pure business logic (trigger-gated INSERT)
│           ├── landing-data.ts         # landing-page query helper
│           └── user-orgs.ts            # role lookup against Supabase
```

## Business logic

All business logic lives in `src/lib/` (NOT in route handlers). The route
handlers are thin wrappers that:

1. Read the SSO session.
2. Parse + validate the request body (via zod).
3. Resolve collaborators (db clients, cert-manager factory).
4. Delegate to a pure service function.
5. Map the typed result to HTTP.

This means `registerDomain(input, deps)` is 100%-unit-testable without an
HTTP server or a real Postgres.

## Security model (Decision 8)

- The Neon connection uses the `redirect_admin_ui` role — no access to
  `reconciler_leases`, no UPDATE on `region_custom_domain_events`.
- The `trg_rcd_verified_binding` trigger is the authoritative gate on
  binding verification — the app-layer check is UX sugar, the DB is truth.
- Per-org quota is enforced in `checkQuota()` plus optional hand-tuned rows in
  `org_domain_quota` (raised by a platform admin).
- `domain_blocklist` rejects reserved hostnames at registration time.

## Env vars

Required (see `src/env.ts` for the canonical list):

| Var                                       | Purpose                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| `NEON_REDIRECT_ADMIN_UI_URL`              | Neon conn string for `redirect_admin_ui` role           |
| `REGION_BINDING_VALIDATOR_URL`            | Base URL for the internal validator (Decision 11)       |
| `REGION_BINDING_VALIDATOR_S2S_SECRET`     | Bearer token for validator S2S auth                     |
| `DATABASE_URL`                            | f3-nation Supabase DB (read-only, for org/role lookups) |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | F3 SSO client (copy from `apps/me`)                     |
| `OAUTH_REDIRECT_URI`                      | SSO callback URL                                        |
| `AUTH_PROVIDER_URL`                       | F3 SSO server URL                                       |
| `SESSION_SECRET`                          | HMAC key for signed session cookie                      |
| `NEXT_PUBLIC_SITE_URL`                    | Public origin                                           |

Optional:

| Var                                   | Default                      | Purpose                                    |
| ------------------------------------- | ---------------------------- | ------------------------------------------ |
| `GCP_PROJECT_ID`                      | `f3-redirects`               | Certificate Manager project                |
| `REDIRECT_CERT_MAP_NAME`              | `redirect-platform-cert-map` | Cert Map name                              |
| `REDIRECT_LB_IPV4`                    | (none)                       | LB IPv4 shown to users after cutover-ready |
| `REGION_BINDING_VALIDATOR_TIMEOUT_MS` | `10000`                      | Validator fetch timeout                    |

## Scope (F3R5_012)

**In:**

- Scaffold app from `apps/me` SSO template
- Pure state-presenter, quota-check, hostname-validation, validator-client, cert-manager-client
- Registration POST handler (with trigger-gated INSERT)
- Status polling, domain listing, delete handler
- Landing page stub + unverified-binding placeholder

**Out (F3R5_013):**

- Decision 9 binding verification evidence UI (full verification flow)
- Decision 6 degraded-state recovery UI
- Binding create/verify POSTs

## Tests

```bash
pnpm --filter @acme/redirect-admin test
```

Target: 40+ unit tests across `state-presenter`, `quota-check`,
`validator-client`, `hostname-validation`, `cert-manager-client`,
`domain-registration`, `env`.
