# Region pages directory

> Human designer: Fortran (@dfoster42)

## 1. Summary

A public, crawlable directory of every active F3 region at
`regions.f3nation.com`: an A–Z / search / near-me list of regions, and one
page per region listing its public weekly workouts (day, time, type,
address, notes, directions) plus region contact links and any hand-curated
upcoming region events. It is the SEO-friendly, link-shareable counterpart to
the map, and reads live F3 data through the public API, so edits show up
without an import.

## 2. Context & links

- App(s) affected: **region-pages** (new), **api** (`packages/api`
  `regionPages` router; `apps/api` client-header dispatch).
- Key code: `packages/api/src/router/region-pages.ts`,
  `packages/api/src/lib/region-pages.ts`,
  `apps/region-pages/src/app/page.tsx`,
  `apps/region-pages/src/app/[regionSlug]/page.tsx`,
  `apps/region-pages/src/app/[regionSlug]/events/[eventSlug]/page.tsx`,
  `apps/region-pages/src/lib/api.ts` (API client),
  `apps/region-pages/src/lib/data.ts` (caching + slug guard),
  `apps/region-pages/src/data/region-events.json`.

## 3. User stories

- As a **visitor (no account)**, I want to find my region by name, letter or
  location so that I can see where and when it works out.
- As a **visitor**, I want a stable `/<region-slug>` URL I can share or find
  from a search engine.
- As a **region leader**, I want edits made in the F3 admin tools to show on
  my region page without anyone running an import.

## 4. Acceptance criteria (testable, non-contradictory)

### Directory (`/`)

- **AC-1** — GIVEN an anonymous visitor WHEN `/` loads THEN the server-rendered
  HTML links every listed region whose name starts with "A", "Found N regions"
  equals the number of distinct active-region slugs, and no sign-in prompt
  appears.
- **AC-2** — GIVEN `/` WHEN the visitor picks a letter THEN the URL becomes
  `/?letter=<letter>` and only regions starting with that letter are listed.
- **AC-3** — GIVEN `/` WHEN the visitor types in the search box THEN
  regions whose name, city, state, zip or country contains the text are
  listed, and Enter on a highlighted suggestion opens that region's page.
- **AC-4** — GIVEN the visitor grants location access WHEN "Find regions
  near me" is on THEN regions whose map center (the middle of their workouts'
  bounds) is within 200 miles are listed, nearest first, each with its
  distance in miles; regions with no mapped workout are never listed.
- **AC-5** — GIVEN an inactive region, or a region under an inactive
  ancestor org WHEN `/` loads THEN that region is not listed.

### Region page (`/<region-slug>`)

- **AC-6** — GIVEN an active region named "Albany, GA" WHEN
  `/albany-ga` loads THEN the page shows that region. The slug is the lodash
  kebab-case of the name, and it must not change: it is the region's public
  URL.
- **AC-6a** — GIVEN two active regions whose names kebab-case to the same slug
  THEN only the lower org id is listed, and the slug resolves to it.
- **AC-7** — GIVEN a region page THEN each listed workout is an active,
  non-private series whose date window is current (starts within 6 days, not
  ended), at an active location, owned by an active AO directly under the
  region, with at least one event type and a day of week.
- **AC-8** — GIVEN two series with the same region, name, day, time and
  address THEN only the one with the higher id is listed.
- **AC-9** — GIVEN a workout with start `0530` and end `0615` THEN its time
  renders as `5:30 AM - 6:15 AM`, and workouts are ordered by next occurrence.
- **AC-10** — GIVEN an active region with no qualifying workouts THEN the
  page shows the "just getting started" state instead of a workout list,
  with the region's website and contact links.
- **AC-11** — GIVEN a slug that matches no active region THEN the response
  is HTTP 404 with a "Region not found" page linking to `/`. A real 404, not a
  redirect, keeps retired regions out of search indexes.
- **AC-12** — GIVEN a region page THEN the links it gives search engines and
  link previews (its canonical URL and Open Graph URL) point to this
  deployment's own address, set by `SITE_URL`.

### Freshness & SEO

- **AC-13** — GIVEN an edit to a region, AO, location or series in the F3
  database THEN the directory and region page reflect it within one hour,
  with no import job.
- **AC-14** — GIVEN `/sitemap.xml` THEN it returns XML listing `/`, every
  active region page and every curated event page; `/robots.txt` points to it.

## 5. Roles & authorization (RBAC)

Both procedures are `publicReadProcedure` (anonymous, session-agnostic,
rate-limited per IP by the shared limiter). They return only public data: region org
contact fields (already public through the map's procedures) and public
workout schedules, under stricter visibility rules than the map (AC-7). No
write paths.

| Action                                       | Allowed | Explicitly denied        |
| -------------------------------------------- | ------- | ------------------------ |
| `regionPages.regions` / `regionPages.region` | Anyone  | —                        |
| See private or inactive series               | No one  | All callers, incl. admin |

## 6. Out of scope / non-goals

- Editing region data here (it is edited in admin / slackbot).
- Storing curated region events in the database. They stay in a JSON file in
  the repo (`apps/region-pages/src/data/region-events.json`), edited by hand.
- On-demand revalidation on edit: the cache windows are the only freshness
  mechanism.

## 7. Critical-path test cases

- AC-1, AC-6, AC-7, AC-11. Implementation rules are in
  [`apps/region-pages/AGENTS.md`](../../apps/region-pages/AGENTS.md).

## 8. Observability

- Events/metrics emitted via `@acme/logger`:
  `region_pages.api.upstream_http_error`,
  `region_pages.api.upstream_request_failed`,
  `region_pages.health.endpoint_failed`.
- `/health` checks the upstream API (`F3_API_BASE_URL` `/ping`).
