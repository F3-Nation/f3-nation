# Org geographic directory map

> Human designer: taterhead247 (@taterhead247)

## 1. Summary

Anyone — no account required — can open the **F3 Geographic Directory** at
`/org` on the homepage and browse F3 Nation's organizational hierarchy on an
interactive map. Orgs are drawn as polygons per layer (sectors → areas →
regions, with AOs as the leaf), and a visitor can drill down by clicking,
search for an org by name, and open a side panel showing an org's leadership,
descendant counts, footprint, and contact links. The hierarchy is
**depth-agnostic**: the set of layers is derived from the shared `OrgType`
config, so inserting a new tier (e.g. a future "territory") or skipping an
unpopulated tier for one branch requires no per-level code.

## 2. Context & links

- App(s) affected: **homepage** (UI), **api** (`packages/api` org-chart router).
- Key code:
  - `apps/homepage/src/app/org/page.tsx`,
    `apps/homepage/src/app/org/_components/org-map-loader.tsx`
  - `apps/homepage/src/app/org/_components/org-map.tsx` (Leaflet map + state),
    `org-info-panel.tsx`, `search-box.tsx`
  - `apps/homepage/src/app/org/_lib/`: `navigation.ts` (depth-agnostic drill
    logic), `org-chart.ts` (`LAYER_TYPES`, `orgTypeRank`, `buildOrgHierarchy`),
    `geo-utils.ts`, `url-state.ts`, `api.ts`, `types.ts`
  - `packages/api/src/router/org-chart/index.ts` (`protectedProcedure` REST reads)
  - `@acme/shared/app/enums` (`OrgType`),
    `@acme/shared/app/org-hierarchy` (`orgTypeDisplay`, `orgTypeRank`)

## 3. User stories

- As a **visitor (no account)**, I want to browse F3's sectors, areas, and
  regions on a map so that I can understand how F3 is organized geographically.
- As a **PAX looking for a leader**, I want to open a region and see its
  leadership (or the nearest higher-level admins) so that I know who to contact.
- As a **PAX sharing a view**, I want the URL to encode the org I'm looking at
  so that a link reopens the same view.
- As a **maintainer**, I want the map to survive a new hierarchy tier (or a
  branch that skips a tier) without code changes per level.
- As an **F3 admin troubleshooting data**, I want to click an org or a leader in
  the info panel to log its database identifiers to the browser console so that
  I can look it up quickly.

## 4. Acceptance criteria (testable, non-contradictory)

### Load & render

- **AC-1** — GIVEN an anonymous visitor WHEN `/org` loads THEN the map renders
  with org polygons for the broadest present layer and no sign-in prompt or
  auth redirect.
- **AC-2** — GIVEN the map is loaded THEN the brand subtitle and the layer
  buttons list exactly the navigable layers present in the data, labeled with
  the plural display names from `@acme/shared` (so a newly added tier appears
  automatically and is pluralized correctly).

### Navigation & drill-down (depth-agnostic)

- **AC-3** — GIVEN a drillable org polygon (e.g. a sector or area) WHEN the
  visitor clicks it THEN the map navigates to that org's next populated child
  layer, updates the breadcrumb, and writes the org's id to the URL.
- **AC-4** — GIVEN a view-only leaf layer org (the most specific navigable
  layer, e.g. a region) WHEN the visitor clicks it THEN the map does **not**
  drill; hovering it still loads its info.
- **AC-5** — GIVEN a branch whose intermediate tier is unpopulated (e.g. a
  region that hangs directly off a sector because its area tier is empty) WHEN
  the visitor drills from the parent THEN navigation skips the empty tier and
  lands on the next populated layer rather than an empty level.
- **AC-6** — GIVEN a selected path WHEN the visitor clicks a breadcrumb crumb
  (or the "Nation" crumb) THEN the view returns to that ancestor's level (the
  Nation crumb returns to the broadest present layer) and the URL updates.
- **AC-7** — GIVEN the International sector is selected WHEN the visitor drills
  into any sub-level THEN every descendant org of that type is shown (not only
  direct children), because International's structure does not nest cleanly
  through the middle tiers.

### URL state

- **AC-8** — GIVEN a deep link `?org=<id>` WHEN the map loads THEN it restores
  the view for that org; selecting a region via search writes the region's own
  id (not its parent area's) so the link reopens the region.
- **AC-9** — GIVEN a `?level=` value that names a navigable layer (e.g.
  `?level=regions`) THEN it is honored; a value naming a non-navigable type
  (`ao`/`nation`), an unrecognized name, or a numeric value is ignored rather
  than stranding the view.

### Search

- **AC-10** — GIVEN the visitor types a non-blank query THEN a result list of
  fuzzy matches across the navigable layers opens; a blank query closes it; a
  non-blank query with no matches shows a distinct "No matches" state.
- **AC-11** — GIVEN search results WHEN the visitor selects one (click or
  Enter) THEN the map navigates to it and the list closes and stays closed —
  including after blurring and re-focusing the input, which must not resurface
  the prior partial-query matches.

### Org info panel

- **AC-12** — GIVEN an org WHEN the visitor hovers (debounced) or selects it
  THEN the panel shows its name, type, email/social links when present,
  descendant counts, footprint (for regions), and leadership.
- **AC-13** — GIVEN an org THEN the counts panel shows one row per navigable
  layer strictly below that org's rank, ordered root→leaf (depth-agnostic).
- **AC-14** — GIVEN an org with no admins on its own record THEN the panel
  surfaces the nearest ancestor **up to and including the nation** that has
  admins; IF an ancestor lookup fails so the result is inconclusive THEN a
  distinct "couldn't verify admins" message shows instead of "No admins
  listed"; AND switching between two admin-less orgs never shows the previously
  viewed org's admins while the new lookup runs.
- **AC-16** — GIVEN an F3 admin with browser devtools open WHEN they click an
  org's title or a leader entry in the info panel THEN the corresponding
  identifiers (org id/name/type, or user/role ids) are logged to the console as
  a quick lookup aid.

### API

- **AC-15** — GIVEN the org-chart endpoints are `protectedProcedure` WHEN the
  homepage client calls `GET /v1/org-chart[/{orgId}]` THEN it presents the
  read-only `NEXT_PUBLIC_ORG_MAP_API_KEY` as a Bearer token (plus the `client`
  header) and receives the directory data; a call with no valid key or session
  is rejected (UNAUTHORIZED), and requests are subject to the per-IP rate limit.

## 5. Roles & authorization (RBAC)

The directory is **public, read-only, and requires no user account**. `/org` is
a static export, so it can't proxy calls server-side the way `apps/map` does;
instead the browser sends a **read-only API key** (`NEXT_PUBLIC_ORG_MAP_API_KEY`)
as a Bearer token on each org-chart request, plus a `client` header. The
org-chart read procedures stay **`protectedProcedure`** — the API key is the
trusted caller, exactly like `apps/map`'s `F3_MAP_API_KEY`. Because it is a
`NEXT_PUBLIC_*` var baked into the static bundle, the key is visible in devtools;
that is acceptable here because it is scoped to the read-only, already-public
org-chart directory data and grants nothing else.

| Action                                         | Allowed                                                     | Explicitly denied                           |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Browse the directory map, search, view details | Everyone, anonymous included (the app supplies the API key) | —                                           |
| Call `GET /v1/org-chart[/{id}]` directly       | Callers presenting a valid API key or session               | Unauthenticated direct calls (UNAUTHORIZED) |
| Create / edit / delete any org data here       | No one (feature is read-only)                               | All callers (no write endpoints exist)      |

All callers are subject to the in-memory per-IP rate limit (~500 req/min per
instance in production) — a per-instance limit, not a global cap.

## 6. Out of scope / non-goals

- Any create/edit/delete of org data (this is a read-only directory).
- End-to-end (Playwright) coverage: the map component is browser/Leaflet-only;
  its pure navigation, search, geometry, and panel logic are unit-tested, and
  the Leaflet render layer is excluded from coverage.

## 7. Critical-path test cases

1. Anonymous `/org` load renders org polygons with no auth wall (AC-1).
2. Drill a sector → area → region: breadcrumb and URL update; deep-linking the
   resulting URL restores the same view (AC-3, AC-8).
3. Drilling a branch with an empty intermediate tier skips to the next
   populated layer (AC-5); the International sector shows descendants of the
   drilled sub-level (AC-7).
4. Search → select a result → list closes and does not reopen on refocus with
   stale matches (AC-11).
5. An admin-less org surfaces the nearest ancestor admins; an inconclusive
   lookup shows the distinct "couldn't verify" message (AC-14).
6. The homepage client presents the API key and receives org-chart data; an
   unauthenticated direct call is rejected (AC-15).

## 8. Observability

- The `/org` client is a static export and does not emit server logs. Client
  fetch failures surface as UI states, not console noise: the map shows
  "Failed to load: …", an org detail failure shows "Failed to load details.",
  and an inconclusive nearest-admin climb shows the "couldn't verify admins"
  message.
- Server side, the org-chart procedures log through `@acme/logger` on error via
  the shared API handler (`api.openapi.handler_error`).
- The info panel intentionally logs org and user identifiers to the browser
  console on click (org title / leader entry) as an admin troubleshooting aid;
  this is deliberate and exposes only already-public directory ids.
