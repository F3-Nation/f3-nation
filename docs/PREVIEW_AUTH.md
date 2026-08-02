# Auth in per-PR preview environments

> Fork-level doc for the AI-SDLC sandbox pilot. Explains how signed-in and
> RBAC E2E tests authenticate against `pr-<n>-*` preview services, and why the
> `run.app` public-suffix cookie restriction does **not** block them.

Each `preview`-labeled PR now deploys three Cloud Run services:

| Service       | App         | Notes                                                               |
| ------------- | ----------- | ------------------------------------------------------------------- |
| `pr-<n>-map`  | `apps/map`  | Own NextAuth (`packages/auth`) on its own host                      |
| `pr-<n>-api`  | `apps/api`  | oRPC API + seeded Postgres sidecar                                  |
| `pr-<n>-auth` | `apps/auth` | SSO / OIDC server + its **own copy** of the seeded Postgres sidecar |

## The cookie question, answered

`*.run.app` is on the [Public Suffix List](https://publicsuffix.org/), so a
cookie can never be scoped to cover both `pr-7-map-…run.app` and
`pr-7-api-…run.app`. Production gets away with a shared cookie because
`map.f3nation.com` / `api.f3nation.com` share `.f3nation.com`
(`packages/auth/src/config.ts` → `getCookieDomain()`).

**It turns out nothing in the preview stack needs a cross-subdomain cookie.**
The codebase already handles `run.app` hosts and has header/proxy-based paths
for every session hop:

1. **`packages/auth` cookies are host-only on `run.app`.**
   `getCookieDomain()` explicitly returns `undefined` for hosts ending in
   `.run.app` (`packages/auth/src/config.ts:66-69`), so the map preview's
   session cookie is scoped to the map host alone — and that is sufficient
   (see next point).

2. **The map app never sends its cookie cross-origin.** The browser client
   calls same-origin `/api/orpc` (`apps/map/src/orpc/client.ts:12-15`); the
   map server proxies to `F3_API_BASE_URL`, forwarding all request headers —
   **including `Cookie`** — plus `Authorization: Bearer $F3_MAP_API_KEY`
   (`apps/map/src/app/api/orpc/[[...rest]]/route.ts:28-42`). The api decodes
   the forwarded NextAuth session cookie because map and api share
   `AUTH_SECRET` (both set to the same placeholder in previews).

3. **The api accepts auth-server JWTs as bearer headers.** `getSession` in
   `packages/api/src/shared.ts` verifies `Authorization: Bearer <jwt>` as an
   RS256 token against `${NEXT_PUBLIC_AUTH_URL}/.well-known/jwks.json` with an
   issuer check (`shared.ts:57-63`, `:200-204`, `:303-363`), then loads roles
   from the DB. Headers don't care about cookie domains.

4. **The admin app (not yet in previews) also needs no shared cookie.** It
   runs an OAuth authorization-code flow against `AUTH_PROVIDER_URL`, stores
   the access token in its **own host-only cookie**, and verifies RS256 via
   the auth server's JWKS (`apps/admin/src/lib/auth/tokens.ts:68-119`,
   `apps/admin/src/lib/auth/server.ts:31-44`).

5. **The auth server's own session cookie is host-only by design** — no
   `domain` attribute at all (`apps/auth/src/lib/auth-options.ts:21-32`). In
   the preview image `NODE_ENV=production`, so the cookie is named
   `__session` (`Secure`, `SameSite=None`).

Conclusion: previews use **bearer JWTs and server-side cookie forwarding**,
never shared browser cookies. Browser SSO across preview apps (e.g. sign in
once on `pr-7-auth`, be signed in on `pr-7-map`) is _not_ how the apps work
even in production — each app mints its own session — so nothing is lost.

## How E2E authenticates

Three independent recipes, from simplest to most complete. All data referenced
is deterministic seed data (`packages/db/src/local-seed-lib/data.ts`) plus the
preview-only fixtures injected by `.github/workflows/preview-env.yml` at
seed-dump time.

### Recipe 1 — Direct api RBAC via seeded API keys (no browser, no auth app)

The seed provides role-bearing API keys (`data.ts:197-218`). Send them as a
bearer token with the `client` header (`packages/api/src/shared.ts:209-294`):

```bash
API=https://pr-7-api-<project>.us-central1.run.app

# admin
curl -H 'Authorization: Bearer local-slackbot-key' -H 'client: e2e' "$API/v1/..."
# editor
curl -H 'Authorization: Bearer local-api-key'      -H 'client: e2e' "$API/v1/..."
# no role (read-only)
curl -H 'Authorization: Bearer local-map-key'      -H 'client: e2e' "$API/v1/..."
```

In Playwright, use a `request` context with those headers. This covers most
RBAC matrix testing (admin vs editor vs unauthenticated) without any UI.

### Recipe 2 — Signed-in map UI via the dev-mode provider

`packages/auth` registers a `dev-mode` credentials provider whenever
`NEXT_PUBLIC_CHANNEL !== "prod"` (`packages/auth/src/config.ts:112-145`) —
previews run with `NEXT_PUBLIC_CHANNEL=branch`, so it is enabled. It signs in
any email as a nation-admin mock user. The cookie is host-only on the map
host, which is all the map needs (see point 2 above).

```bash
MAP=https://pr-7-map-<project>.us-central1.run.app
JAR=/tmp/jar

CSRF=$(curl -sc "$JAR" "$MAP/api/auth/csrf" | jq -r .csrfToken)
curl -sb "$JAR" -c "$JAR" -X POST \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=dev-admin@f3local.dev" \
  --data-urlencode "json=true" \
  "$MAP/api/auth/callback/dev-mode"
# $JAR now holds the map session cookie; subsequent map page loads and
# /api/orpc calls are authenticated (the proxy forwards the cookie to the api).
```

In Playwright: perform the same POST in a `request` context, then copy the
cookie into the browser context (`context.addCookies`) — or drive the sign-in
page UI directly.

### Recipe 3 — Auth-server JWT for api bearer auth (full SSO loop)

This exercises the real `apps/auth` OIDC machinery end to end and yields an
RS256 access token the api accepts as `Authorization: Bearer`.

Preview-only fixtures make it drivable without SMTP (previews have a
plainly-fake `EMAIL_SERVER`, so the email-MFA _send_ path fails by design):

- Every seeded dev user (`dev-admin@f3local.dev`, `dev-editor@f3local.dev`,
  `dev-user@f3local.dev`) has a stack of 40 pre-provisioned MFA codes, all
  with the fixture code **`424242`** (stored SHA-256-hashed, far-future
  expiry). Codes are consume-once per warm instance; the in-memory DB restores
  all 40 on every cold start.
- Dev users are marked `onboarding_completed`, so `/api/oauth/authorize`
  issues codes instead of redirecting to `/onboarding`.
- The seeded OAuth client `f3-me-local` (secret `local-me-client-secret`,
  redirect URI `http://localhost:3003/api/auth/callback`) is used purely as a
  code-minting client — the test reads the code from the redirect `Location`
  header and never follows it.

```bash
AUTH=https://pr-7-auth-<project>.us-central1.run.app
API=https://pr-7-api-<project>.us-central1.run.app
JAR=/tmp/auth-jar

# 1. Sign in to the auth server with the fixture MFA code
CSRF=$(curl -sc "$JAR" "$AUTH/api/auth/csrf" | jq -r .csrfToken)
curl -sb "$JAR" -c "$JAR" -X POST \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=dev-admin@f3local.dev" \
  --data-urlencode "code=424242" \
  --data-urlencode "json=true" \
  "$AUTH/api/auth/callback/email-mfa"
# jar now holds the auth session cookie (named __session — NODE_ENV=production)

# 2. PKCE authorize — read the code off the redirect, don't follow it
VERIFIER=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
LOCATION=$(curl -sb "$JAR" -o /dev/null -w '%{redirect_url}' \
  "$AUTH/api/oauth/authorize?response_type=code&client_id=f3-me-local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback&scope=openid%20profile%20email&code_challenge=$CHALLENGE&code_challenge_method=S256")
CODE=$(printf '%s' "$LOCATION" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')

# 3. Exchange for an RS256 access token
TOKEN=$(curl -s -X POST "$AUTH/api/oauth/token" \
  -d grant_type=authorization_code -d code="$CODE" \
  -d client_id=f3-me-local -d client_secret=local-me-client-secret \
  -d redirect_uri=http://localhost:3003/api/auth/callback \
  -d code_verifier="$VERIFIER" | jq -r .access_token)

# 4. Call the api as the signed-in dev admin
curl -H "Authorization: Bearer $TOKEN" "$API/v1/..."
```

The api verifies the token against `pr-<n>-auth`'s JWKS (its
`NEXT_PUBLIC_AUTH_URL` points at the auth preview) and resolves roles from its
own seeded DB — user ids match across the two DB copies because the seed is
deterministic.

## Deployment mechanics

- `pr-<n>-auth` is deployed from `.github/preview/auth-service.template.yaml`
  by `preview-env.yml`, mirroring the api service: seeded Postgres sidecar on
  `localhost`, scale-to-zero, max 1 instance, `preview-env=true` label (so the
  daily reaper and teardown cover it).
- `AUTH_JWT_PRIVATE_KEY` is a **throwaway RSA key generated fresh in the
  workflow at each deploy** — never committed, never reused, never a real
  credential. The api only ever sees the public half via
  `/.well-known/jwks.json`. Every push redeploys api and auth together, so
  JWKS caches can't go stale across a key rotation.
- All other env values are the same plainly-fake placeholders the api/map
  previews use. `AUTH_SECRET` does **not** need to match between auth and
  map/api (the auth↔api trust is asymmetric RS256, not shared-secret); map
  and api _do_ share it, as before, for the forwarded-cookie path.

## Threat model

Three facts, combined, have one consequence worth stating explicitly rather
than leaving implicit across three files:

- Preview services are made **publicly invokable** —
  `--member=allUsers --role=roles/run.invoker` (`preview-env.yml`, three call
  sites).
- Preview URLs are **deterministic and posted in a PR comment**, so they're
  discoverable, not secret.
- The dev-mode provider (Recipe 2 above) **signs in any email as a
  nation-admin mock user**, with no verification.

**Net effect: every preview URL is an open, unauthenticated admin console.**
That is fine — but _only_ because the data behind it is a synthetic seed on a
tmpfs sidecar, never real data. That's the one load-bearing assumption:

- A preview may **only ever** be pointed at the deterministic synthetic seed.
  Never a production, staging, or restored-from-real-data database — the
  public auto-admin surface makes any real data in a preview immediately
  world-readable and world-writable.
- Previews carry no real secrets: `AUTH_SECRET`, `API_KEY`,
  `SUPER_ADMIN_API_KEY`, etc. are placeholders in the service templates. The
  only live credential in the whole stack is the referrer-locked browser Maps
  key.

## Known constraints

- **Two database copies.** `pr-<n>-api` and `pr-<n>-auth` each run their own
  sidecar restored from the same dump. Seeded rows (dev users, clients, keys,
  ids) are identical, but runtime writes diverge: a user registered through
  the auth preview's UI exists in whichever DBs the code paths write to, not
  magically in both. E2E should stick to seeded users.
- **No email delivery.** `EMAIL_SERVER` is fake; any flow that _sends_ an
  email (new-user MFA send, magic links for arbitrary addresses) fails in
  previews. Use the fixture code `424242` with the seeded dev users.
- **`NODE_ENV=production` semantics** in the auth image: session cookie is
  `__session` (Secure, SameSite=None), and the `/api/verify-email` rate limit
  (10/min/IP) is active — irrelevant when using the fixture-code recipe.
- **MFA fixture codes are finite per warm instance** (40 per dev user,
  consume-once). Practically unlimited for E2E runs; a cold start (scale to
  zero) restores the full stack.
- **Browser SSO across preview apps is not supported** — and not needed (see
  above). If a future feature genuinely requires one cookie spanning multiple
  preview apps, the fix is a shared custom preview domain (e.g. Cloud Run
  domain mappings for `pr-<n>-map.preview.f3nation.dev` etc., or a global
  external HTTPS LB with a wildcard cert). Not configured here.
- **`apps/admin` is not part of previews yet.** When it is added, it needs
  `AUTH_PROVIDER_URL` pointed at `pr-<n>-auth`, plus a seeded OAuth client
  whose redirect URI matches the admin preview URL (injectable in the seed
  step, where the PR number is known).
