<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# F3 Region Pages — Agent Guide

Public, anonymous directory of F3 regions and their weekly workouts at
`regions2.f3nation.com`. **Spec (source of truth for behavior):**
[`docs/specs/region-pages-directory.md`](../../docs/specs/region-pages-directory.md).

## How it works

- **No database.** Data comes from the public `regionPages.regions` /
  `regionPages.region` procedures on apps/api over HTTP (`src/lib/api.ts`,
  client header `f3-region-pages`). Router:
  `packages/api/src/router/region-pages.ts`. Shaping (slugs, social URLs,
  time format, dedup, region area/zoom): `packages/api/src/lib/region-pages.ts`.
- **Caching.** `src/lib/data.ts` caches API reads for `DATA_TTL_SECONDS`
  (5 min); region pages use ISR with a 50 min window. Together with the API's
  60 s cache, edits show within an hour (spec AC-13). Region pages are on-demand ISR; `/` and `/sitemap.xml` render per
  request from the cached data.
- **Env** (`.env.example`): `F3_API_BASE_URL`, `F3_CHANNEL`, `SITE_URL`,
  `GA_MEASUREMENT_ID`. No secrets.

## Rules

1. **Slugs are public URLs.** A slug is lodash `kebabCase(region.name)`. Never
   change how slugs are built: existing links and search results use them. When two names
   produce one slug, the lowest org id wins everywhere.
2. **Visibility rules live in the API and match the map** (active, non-private,
   current series, at an active location, under an active AO directly beneath
   an active region with active ancestors). Change them only in the router,
   and update spec AC-7 and the router tests in the same PR.
3. **The endpoints are anonymous.** Return nothing beyond what
   `map.location.eventsAndLocations` already exposes. No user PII.
4. **Never key a cache or API call on unvalidated input.** `getRegion` checks
   the slug against the cached region list first, and the API resolves slugs
   against a fixed-key cache. Keep both checks, so made-up URLs never reach the
   database or grow a cache.
5. **Render database HTML only through `useSanitizedHtml`**
   (`src/lib/safe-html.tsx`). Calling `sanitizeHtmlToReactNodes` during render
   breaks hydration. Never use `dangerouslySetInnerHTML`. Description links
   may be http(s), `mailto:`, `tel:` or relative (`isSafeHref`); stored
   website and social URLs must be http(s) (`httpUrlOrNull` in the API lib).
   When sanitizing leaves no text, render the default description
   (`useRegionDescription`), never the raw string.
6. **Nothing fetches at build time.** The Docker build has no API access.
   `generateStaticParams` returns `[]`, and `/` is `force-dynamic`.
7. **Route segment config must be a literal**, e.g. `revalidate = 3000`. A
   constant fails the build. If you change any cache TTL, keep the total
   under 1 h (see the budget in `src/lib/site.ts`).
8. **Config goes through `src/env.ts`** (validated), never raw `process.env`.
   `src/instrumentation.ts` loads it at boot and exits on invalid config, so a
   misconfigured Cloud Run revision fails to start instead of serving 500s.
   No `NEXT_PUBLIC_*` variables: Next inlines them at build, and one image
   serves both staging and prod.
9. **Tailwind v4 with OS (media) dark mode.** This app does not use `@acme/ui`
   or the shared class-based dark mode. v4 generates numeric utilities
   (`w-150` is 600px), and v3's `shadow-sm` / `outline-none` are now
   `shadow-xs` / `outline-hidden`. Check visually against production.
10. **Keep the directory payload small.** `/` sends `RegionSummary`
    (`src/types/region.ts`), not the full region. Add fields there only if the
    list renders them.
11. **Tests pin behavior.** Never add a test just to move the coverage number.
    Declarative files with no logic (layouts, error/not-found shells, env
    schema, inline SVGs) are excluded from coverage in `vitest.config.ts`.
12. **Release order:** ship the `api` release containing any `regionPages`
    change before the `region-pages` release that relies on it.

## Local dev

```bash
pnpm -F f3-region-pages dev
```

Needs apps/api running, with `F3_API_BASE_URL` pointing at it (default
`http://localhost:3001/v1`). Port: `F3_REGION_PAGES_PORT`, default 3006. Slotted
checkouts (`local:setup --slot N`) don't assign this port yet. The curated
events in `src/data/region-events.json` are edited by hand.
