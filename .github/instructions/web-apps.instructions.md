---
applyTo: "apps/map/**,apps/admin/**,apps/me/**,apps/homepage/**,apps/auth/src/app/**,packages/ui/**,packages/observability/**"
---

# Next.js apps and shared UI

Each Next app's `AGENTS.md` warns that this Next version differs from
training data. Check `node_modules/next/dist/docs/` before suggesting a
framework API change.

## Server/client boundary

- `NEXT_PUBLIC_*` values are inlined at `next build`.
  - A value that differs per environment in a prebuilt image must reach the
    client at runtime (a server prop or runtime-config endpoint).
  - A new `NEXT_PUBLIC_*` needs an `ARG`/`ENV` in the app's Dockerfile, a
    build arg in the deploy workflows, and a default that passes the app's
    `env.ts` schema (never `""` for an enum).
  - Never put an API key or bearer token in a `NEXT_PUBLIC_*` var or a
    static-export bundle (`apps/homepage`).
- Never import `~/env` from `instrumentation-client.ts`, or from client code
  that reads runtime-only public values: validation throws in the browser and
  white-screens the page. Read `process.env.NEXT_PUBLIC_X` directly there. Do
  not tighten `NEXT_PUBLIC_*` schemas with throwing refinements.
- Optional, cosmetic settings must not use a throwing validator in `env.ts`.
  A typo would 500 every route.
- Never import `@acme/logger` (pino, Node-only) into a `"use client"` module
  or anything in the browser bundle; it breaks `next build`. Browser errors go
  to the app's existing reporter (PostHog `captureException`).
  - Do not add new `console.*` sites. The `AGENTS.md` carve-out
    (observability pipeline, `global-error.tsx`) is exhaustive.

## Rendering and caching

- Render the same markup on the server and on first hydration.
  - No `typeof window`/`DOMParser` branches in render.
  - Swap in browser-only content in an effect.
  - Don't hide crawlable lists behind a `mounted` flag.
- Don't force a static route dynamic: no per-request `headers()`/`cookies()`
  or `fetch(..., { cache: "no-store" })` in a root layout, or in shared code
  that statically rendered routes import (`packages/api/src/shared.ts`). Use
  `next: { revalidate }`.
- Metadata routes (`robots.ts`, `sitemap.ts`) that read runtime env must be
  `force-dynamic`, or the build-time URL ships to every environment.
- Standalone images run from `/app/apps/<app>`; files read through
  `process.cwd()` must be copied there.
- Error boundaries:
  - Render `digest`, never `error.message`.
  - Report in an effect, guarded so a failing reporter can't throw.
  - Don't double-report errors already captured by `onRequestError`.
- Place `loading.tsx` only beside a `page.tsx`. Suspense fallbacks render only
  for suspending queries (`useSuspenseQuery`).
- An "API unavailable" state covers network failures, your own timeouts and
  5xx only.
  - A bare `AbortError` (navigation, unmount) is not an outage, and neither
    is a 4xx or 429.
  - Clear timers and abort listeners in `finally`.
  - Never turn an outage into "no access".

## Data and state

- oRPC query keys sit under the procedure path so `invalidateQueries`
  reaches them.
- Never `.sort()` a cached array in place.
- Don't reset form state on a background refetch.
- Async UI that can overlap (hover, search-as-you-type) must ignore
  superseded responses and clear old results on a new query.
- Merging two queries must never fall back to another entity's fields (AO,
  logo, contacts) when the selected id has no match.
- Edit forms:
  - Send back fields the form doesn't expose (scopes, flags).
  - Block submit when the edit target failed to load, so it never falls back
    to create.
  - Keep the created id on partial failure so a retry doesn't duplicate.
- Disable submit while a mutation is pending. Reset loading state on every
  exit path, and show the server's error message.
- Client Zod schemas mirror server limits from the same shared constants.
- UI role gates match the router's required role for the same action.
- Admin tables:
  - Columns the server can't sort set `enableSorting: false` and render a
    plain header.
  - Filters derive from one pure function of URL or state, not from effects
    syncing child state.

## Correctness

- Date-only `YYYY-MM-DD` values are calendar dates. Format them with
  `timeZone: "UTC"`, never `new Date(str).toLocaleDateString()`.
- Use `||` when an empty string must fall back; `??` only catches
  null/undefined.
- Check nullable numbers with `!= null`, because `0` is a valid coordinate.
- Before deleting a "dead" guard, check whether the type is lying (cast
  JSON, URL params, LEFT JOINs, keys present but undefined).
- Rendered list keys are unique across entity kinds (prefix the kind;
  ids collide).
- Build an `href` from stored URLs only after parsing it:
  - Require http(s) and an anchored hostname check.
  - Rebuild the URL rather than returning raw input.
  - External links get `rel="noopener noreferrer"`.
- Use per-function lodash imports (`lodash/omit`).

## UI and accessibility

- Before copying a component between apps, check `@acme/ui`. New shadcn
  primitives go in `packages/ui`.
- Forms use `FormField` → `FormItem` → `FormLabel`/`FormControl`/
  `FormMessage`. Never override the id `FormControl` assigns.
- Icon-only buttons need an accessible name and `type="button"`. A dialog
  needs a (visually hidden) `DialogTitle`. Use complete ARIA patterns only, and
  keep heading levels nested.
- Session replay keeps text and media masked.
- Analytics URL properties are scrubbed of query strings, because auth URLs
  carry codes.
- UI changes in `apps/map` include screenshots in the PR.
