# Next.js apps

Shared rules for the Next.js apps (`map`, `admin`, `me`, `auth`, `homepage`).
Each app's own `AGENTS.md` adds app-specific notes and the reminder to check
`node_modules/next/dist/docs/` before relying on a framework API. The non-Next
apps (`api`, `slackbot`, `analytics`) have their own `AGENTS.md`.

## Env and the client bundle

- `NEXT_PUBLIC_*` values are inlined at `next build`. A value that differs per
  environment in a prebuilt image reaches the client at runtime (for example a
  server prop). A new one needs an `ARG`/`ENV` in the app's Dockerfile and a
  build arg in its deploy workflow (`apps/homepage`: the workflow's build env),
  with a default that passes `env.ts` (never `""` for an enum).
- Only public-read keys may be `NEXT_PUBLIC_*` or sit in the `apps/homepage`
  static bundle; never a privileged key or token.
- Client code, including `instrumentation-client.ts`, imports the env module
  only if every `NEXT_PUBLIC_*` schema is non-throwing (optional, no
  refinements, as in `apps/map`). The browser has no `CI` or
  `SKIP_ENV_VALIDATION`, so a rejected value throws on import and white-screens
  the page. Where one is required (`apps/auth`), read
  `process.env.NEXT_PUBLIC_X` directly.
- Optional, cosmetic settings don't use a throwing validator in `env.ts`; a
  typo would fail every route that imports it.
- Never import `@acme/logger` (pino, Node-only) into a `"use client"` module;
  browser errors go to PostHog `captureException`.
- Session replay keeps `maskAllInputs` and text masking on.

## Rendering and caching

- Render the same markup on the server and on first hydration: no
  `typeof window`/`DOMParser` branch in render, swap in browser-only content in
  an effect, and don't hide crawlable lists behind a `mounted` flag.
- Don't force a static or ISR route (`apps/map` `/`) dynamic: no
  `headers()`/`cookies()` or `fetch(..., { cache: "no-store" })` in its root
  layout or in shared code it imports (`packages/api/src/shared.ts`). Use
  `next: { revalidate }`. `apps/admin` is dynamic by design.
- Metadata routes (`robots.ts`, `sitemap.ts`) that read runtime env are
  `force-dynamic`, or the build-time URL ships to every environment; in the
  `apps/homepage` static export they're `force-static`.
- Standalone images run from `/app/apps/<app>`; files read through
  `process.cwd()` are copied there.
- Error boundaries render `digest`, never `error.message`, and report in an
  effect wrapped so a failing reporter can't throw.
- "API unavailable" covers network failures, your own timeouts and 5xx only.
  A 4xx or 429 isn't an outage, and neither is a bare client-side `AbortError`
  (navigation, unmount). Clear timers and abort listeners in `finally`, and
  never turn an outage into "no access".

## Data and state

- Custom oRPC query keys hold the procedure path array at `queryKey[0]`, or
  `invalidateQueries` can't reach them.
- Never `.sort()` a cached array in place, and don't reset form state on a
  background refetch.
- Async UI that can overlap (hover, search-as-you-type) ignores superseded
  responses and clears old results on a new query.
- Edit forms send back fields they don't expose (scopes, flags), block submit
  when the edit target failed to load (so they never fall back to create), and
  keep the created id on partial failure so a retry doesn't duplicate.
- Disable submit while a mutation is pending, reset loading state on every exit
  path, and show the server's error message.
- Client Zod schemas mirror the server's limits, and UI role gates match the
  router's required role for the same action.
- Admin tables: a column the server can't sort sets `enableSorting: false` and
  renders a plain header. The shared `Header` always renders a sort button, and
  unknown sort ids are silently dropped, leaving no `ORDER BY`.

## Correctness

- Date-only `YYYY-MM-DD` values are calendar dates: format them with
  `timeZone: "UTC"`, never `new Date(str).toLocaleDateString()`.
- Use `||` when an empty string must fall back (`??` only catches
  null/undefined), with a scoped `eslint-disable` for `prefer-nullish-coalescing`
  that gives the reason.
- Check nullable numbers with `!= null`; `0` is a valid coordinate.
- Before deleting a "dead" guard, check whether the type is lying (cast JSON,
  URL params, LEFT JOINs, keys present but undefined).
- Rendered list keys are unique across entity kinds (prefix the kind).
- Build an `href` from a stored URL only after parsing it: require http(s), use
  an anchored hostname check, and rebuild the URL instead of returning raw
  input.
- Use per-function lodash imports (`lodash/omit`).

## UI and accessibility

UI primitives live in `packages/ui`; see its `AGENTS.md`.
