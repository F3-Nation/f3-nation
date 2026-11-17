# Org geographic directory map

> Human designer: taterhead247 (@taterhead247)

## 1. Summary

Anyone — no account required — can open the **F3 Geographic Directory** at
`/org` on the homepage and browse F3 Nation's organizational hierarchy on an
interactive map. Orgs are drawn as polygons per layer (sectors → areas →
regions, with AOs as the leaf), and a visitor can drill down by clicking,
search for an org by name, and open a side panel showing an org's leadership,
descendant counts, footprint, and contact links. Clicking the leaf layer (a
region) reveals its **AOs** as location pins on the map; hovering or clicking a
pin opens a panel listing the AOs active at that location with their leadership
and contact links. The hierarchy is
**depth-agnostic**: the set of layers is derived from the shared `OrgType`
config, so inserting a new tier (e.g. a future "territory") or skipping an
unpopulated tier for one branch requires no per-level code.

## 2. Context & links

- App(s) affected: **homepage** (UI), **api** (`packages/api` org-chart router).
- Key code:
  - `apps/homepage/src/app/org/page.tsx`,
    `apps/homepage/src/app/org/_components/org-map-loader.tsx`
  - `apps/homepage/src/app/org/_components/org-map.tsx` (Leaflet map + state),
    `org-info-panel.tsx`, `location-info-panel.tsx` (AO location panel),
    `search-box.tsx`
  - `apps/homepage/src/app/org/_components/org-directory.tsx` (Map/Table
    host; carries selections across switches), `directory-spinner.tsx`,
    `view-switcher.tsx`, `org-table.tsx` (Table view), `org-accordion.tsx`
    (Table view on portrait phones), `leader-parts.tsx` (avatar, tags, and
    placeholder labels shared by both), and `_lib/leadership-table.ts` (Table
    rows, cascading filters, org grouping), `_lib/leadership-csv.ts` (Table
    CSV export), `_lib/use-media-query.ts` (portrait-phone detection),
    `_lib/viewport-restore.ts` (when a refresh's saved view is restored)
  - `apps/homepage/src/app/org/_lib/`: `navigation.ts` (depth-agnostic drill
    logic), `org-chart.ts` (`LAYER_TYPES`, `orgTypeRank`, `buildOrgHierarchy`),
    `geo-utils.ts`, `url-state.ts`, `api.ts`, `use-ao-search.ts` (debounced
    server-side AO search), `types.ts`
  - `packages/api/src/router/org-chart/index.ts` (`protectedProcedure` REST
    reads: `all`, `byId`, `byLocation` for AO location details, `aos`
    for AO name search, and `leadership` for the Table view)
  - `@acme/shared/app/enums` (`OrgType`),
    `@acme/shared/app/org-hierarchy` (`orgTypeDisplay`, `orgTypeRank`)

## 3. User stories

- As a **visitor (no account)**, I want to see either a Map view or a Table
  view of the directory, with the Map view loading by default.
- As a **visitor in the Table view**, I want to search for a sector,
  territory, area, or region.
- As a **visitor in the Table view**, I want to see all positions and roles
  with their related information in three columns: **Org** (the org's name and
  its level, e.g. "Boone (Region)"), **PAX** (avatar, name, and home region, e.g. "Gator (Coral Gables)"), and
  **Position/Role** (the position or role name and its type).
- As a **visitor in the Table view**, I want filter dropdowns for sector,
  territory, area, and region whose options update based on what else is
  selected — e.g. with the North Carolina territory selected, only areas and
  regions in North Carolina are offered.
- As a **visitor in the Table view**, I want to choose multiple orgs in each
  filter and search within a filter's options.
- As a **visitor in the Table view**, I want to sort the table by any column.
- As a **visitor in the Table view**, I want to download a CSV of the rows
  matching my current filter selections.
- As a **visitor**, when I switch from the Map to the Table view, I want the
  Map's current selection to set the Table's filter selections.
- As a **visitor**, when I switch from the Table to the Map view, I want the
  Table's filter selections to set the Map's selection; where a filter has
  several selections, the Map uses the lowest filter that has exactly one
  (e.g. one sector, one territory, and three areas selected → the territory).
- As a **visitor on the Map view**, I want a page refresh to keep my
  selections and zoom level.
- As a **visitor on the Table view**, I want a page refresh to keep my filter
  selections.
- As a **visitor in the Table view**, I want to clear all my filter selections
  at once when any are selected.
- As a **visitor in the Table view**, when I select one or more parent orgs, I
  want their child orgs that have no positions listed to appear too, marked
  "NO PAX LISTED" and "NO POSITIONS FILLED" in a distinct style, so I can see
  where leadership is missing.
- As a **visitor on the Map view**, I want the breadcrumb directly above the
  search box.
- As a **visitor on desktop**, I want the Map / Table toggle at the top right
  in both views.
- As a **visitor on a portrait phone in the Table view**, I want the filters
  stacked vertically and the results grouped by org in an accordion — each
  person's PAX and position/role on one visible line, the first org with
  positions open, the rest closed, with an arrow showing each org's state.
- As a **visitor in the Table view** with no filters selected (opened directly,
  or switched from the Map with nothing selected), I want to see only the
  sector positions, without their child orgs.
- As a **visitor (no account)**, I want to browse F3's sectors, areas, and
  regions on a map so that I can understand how F3 is organized geographically.
- As a **PAX looking for a leader**, I want to open a region and see its
  leadership (or the nearest higher-level admins) so that I know who to contact.
- As a **PAX sharing a view**, I want the URL to encode the org I'm looking at
  so that a link reopens the same view.
- As a **visitor exploring a region**, I want to click a region to see its AOs
  as pins on the map and open a pin to view that location's AOs — their
  leadership, contact links, and active-event count.
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
  The search placeholder lists those same present layers from broadest to most
  specific using their shared plural labels, followed by AOs, which are searched
  separately on the server.

### Views

- **AC-24** — GIVEN an anonymous visitor WHEN `/org` loads THEN the **Map**
  view is shown by default (unless the URL says `?view=table`, AC-36).
- **AC-25** — GIVEN either view THEN a Map / Table switcher is visible and
  marks the current view. On desktop (the side-by-side layout, including
  sideways phones) it sits at the top right of the header in both views; on
  phones it sits at the right of the title row; WHEN the visitor selects the other option THEN that
  view is shown without a full page reload.
- **AC-33** — GIVEN the Map view with an org selected (the org in `?org=`)
  WHEN the visitor switches to the Table THEN that org is checked in its
  layer's filter, along with its ancestors (as in AC-27), and the rows are
  scoped to it. An org outside the Table's layers is ignored. From the Nation
  view (no org), no filters are checked.
- **AC-34** — GIVEN the Table view WHEN the visitor switches to the Map THEN
  the Map opens on the checked org in the **narrowest** filter that has
  **exactly one** checked org, at that org's default level and fit (e.g. one
  sector, one territory, and three areas → the territory; one region → that
  region). When no filter has exactly one checked org, the Map opens at Nation.
- **AC-35** — GIVEN the Map view WHEN the visitor drills, pans, or zooms THEN
  the URL keeps the selection (`?level=` / `?org=`, AC-8) plus the center and
  zoom as `?at=<lat>,<lng>,<zoom>` (5 decimals), rewritten after each move
  without adding history entries; WHEN the page is refreshed THEN the same
  selection opens at the saved center and zoom instead of the default fit.
  The next navigation fits as usual, including clicking the current crumb or
  the active layer button. An `?at=` that is malformed or out of
  range (latitude beyond ±90, longitude beyond ±180, zoom outside 2–20) is
  ignored and the default fit applies.
- **AC-36** — GIVEN the Table view THEN the URL holds `?view=table` and the
  checked org ids as `?orgs=<id>,<id>,…` (broadest layer first), rewritten on
  every filter change without adding history entries; WHEN the page is
  refreshed THEN the Table view reopens with the same orgs checked. Ids that
  are invalid, unknown, or outside the Table's layers are ignored, and a
  listed org's ancestors are checked as in AC-27. Sort order is not kept.
  Because the view and selections come from the URL, `/org` renders in the
  browser only (a spinner shows until it loads).

### Table view

- **AC-26** — GIVEN the Table view WHEN it loads THEN the orgs and all
  leadership are fetched in a single request (AC-30) and the table lists one
  row per person per position or role held at a navigable-layer org (sector,
  territory, area, region — never nation or AO). Unlike the Map, the Table
  includes orgs with no active locations, so leaders at an org nobody meets at
  yet are still listed. The columns are, in order: **Org** — the
  org's name followed by its level in parentheses (the org type's display
  label, e.g. "Boone (Region)"); **PAX** — the person's avatar (initials when
  there is none), F3 name, and home region name in parentheses, e.g.
  "Gator (Coral Gables)" (the parentheses are omitted when the person has no
  active home region); and **Position/Role** — the position or role
  title with a tag saying whether it is a position or a role. Roles are limited to the same visible roles as the info panel (admin,
  editor). Rows are ordered broadest level first, then org name (orgs that
  share a name stay apart), then title, then F3 name.
- **AC-27** — GIVEN the Table view THEN there is one multi-select filter per
  present navigable layer, broadest first, each showing "All" when nothing is
  chosen, the org's name when one is, and "N selected" otherwise. Opening a
  filter shows a search box that narrows its options by name and a checkbox
  per option. A filter's options are only the orgs of that layer inside the
  orgs chosen in broader filters (e.g. with the North Carolina territory
  chosen, the Area and Region filters offer only orgs in North Carolina; with
  North Carolina and Florida chosen, orgs in either). Checking an org also
  checks its ancestors in the broader filters; unchecking an org also unchecks
  any narrower choices inside it. Each filter has a "Clear" action that
  unchecks everything in it and in the narrower filters. Escape closes an open
  filter and returns focus to its button; moving focus out of the popup (e.g.
  tabbing past its last option) or clicking outside closes it.
- **AC-39** — GIVEN the Table view with no filter set (opened directly by
  URL, switched from the Map with nothing selected, or after Clear filters)
  THEN it lists only positions and roles at broadest-layer orgs (sectors),
  without their child orgs, with a placeholder row (AC-38) for each sector
  that has nobody listed.
- **AC-28** — GIVEN one or more filters THEN the table shows rows for each
  chosen org that has no chosen descendant, plus every org beneath it (e.g.
  North Carolina and Florida chosen with only the Western NC area → rows in
  Western NC and in all of Florida), with a count of shown rows; WHEN no rows
  match THEN it says "No positions or roles match these filters."
- **AC-38** — GIVEN one or more filters THEN every navigable-layer org in view
  (AC-28) with no position or role holder gets one placeholder row in its
  default-order place: the Org column as usual, PAX reading **NO PAX LISTED**
  (with an empty dashed avatar), and Position/Role reading **NO POSITIONS
  FILLED**. Placeholder rows are visually distinct from people rows (tinted
  background, muted italic uppercase labels). The count reads "N positions and
  roles · M orgs with no positions filled" (the second part only when M > 0;
  N counts people rows only). Sorting by PAX or Position/Role keeps
  placeholder rows after people rows in either direction; sorting by Org sorts
  them with the rest. With no filter set, the same applies to the sectors in
  view (AC-39). Download
  CSV (AC-32) includes them with PAX "NO PAX LISTED", Position/Role "NO
  POSITIONS FILLED", and blank Home Region and Type.
- **AC-29** — GIVEN the Table view's search box WHEN the visitor types THEN it
  suggests matching sectors, territories, areas, and regions (no AOs); WHEN the
  visitor selects one THEN that org is checked exactly as if it had been
  checked in its filter.
- **AC-31** — GIVEN the Table view THEN each column header (Org, PAX,
  Position/Role) is a sort button: the first click sorts ascending by that
  column (Org by org name, PAX by F3 name, Position/Role by title), the second
  descending, and the third returns to the default order (AC-26). Every
  sortable header shows a neutral sort icon (↕) by default so it reads as
  sortable; the sorted header replaces it with its direction (▲ or ▼) and
  exposes it via `aria-sort`; ties keep the
  default order.
- **AC-37** — GIVEN the Table view WHEN at least one filter has a checked org
  THEN a **Clear filters** button shows beside the filters; WHEN the visitor
  clicks it THEN every filter returns to "All", the table lists the sector
  rows (AC-39), the URL drops its `orgs` (AC-36), and the button hides. It is
  hidden while no filter is set. Each filter's own Clear works as in AC-27.
- **AC-41** — GIVEN the Table view on a portrait phone (the same viewports
  as AC-23's phone layout) THEN the filters stack in one column (search, then
  one filter per row, then Clear filters), and in place of the table the rows
  in view (AC-28, AC-38, AC-39) are grouped into an accordion with one section
  per org, in the table's order. Each section header shows the org's name and
  level, e.g. "Boone (Region)", with ▼ when open and ▶ when closed, and
  toggles on tap (`aria-expanded`). Inside an open section each person is one
  line: avatar, F3 name, home region in parentheses, then the position/role
  title and its Position/Role tag, cut short with an ellipsis rather than
  wrapping. An org with nobody listed shows one placeholder line, "NO PAX
  LISTED · NO POSITIONS FILLED", in the AC-38 style. When the rows load or the
  filters change, the first org with anyone listed is open and all others are
  closed. The count and Clear filters (AC-37) work as on desktop; Download CSV
  (AC-32) and the column sort (AC-31) are not shown. Landscape phones and wider
  screens keep the table.
- **AC-32** — GIVEN the Table view WHEN the visitor clicks **Download CSV**
  THEN the browser saves `f3-positions-and-roles-YYYY-MM-DD.csv` (the local
  date) containing exactly the rows currently shown — the current filter
  selections applied, in the current sort order — with no extra request. The
  columns are, in order: Org (name), Level (e.g. Region), PAX (F3 name, or
  "Unknown"), Home Region (blank when none), Position/Role (title), and Type
  (Position or Role). The file is UTF-8 with a byte-order mark and CRLF line
  endings; fields containing commas, quotes, or line breaks are quoted, and
  any field starting with `=`, `+`, `-`, `@`, tab, or carriage return is
  prefixed with an apostrophe so spreadsheet apps don't run it as a formula.
  The button is disabled when no rows match, and is not shown on portrait
  phones (AC-41).

### Navigation & drill-down (depth-agnostic)

- **AC-3** — GIVEN a drillable org polygon (e.g. a sector or area) WHEN the
  visitor clicks it THEN the map navigates to that org's next populated child
  layer, updates the breadcrumb, and writes the org's id to the URL.
- **AC-4** — GIVEN a leaf layer org (the most specific navigable layer, e.g. a
  region) WHEN the visitor clicks it THEN the map does **not** drill to a child
  layer; instead it reveals the region's AO location pins (see AC-17). Hovering
  the region still loads its info while no pins are shown.
- **AC-5** — GIVEN a branch whose intermediate tier is unpopulated (e.g. a
  region that hangs directly off a sector because its area tier is empty) WHEN
  the visitor drills from the parent THEN navigation skips the empty tier and
  lands on the next populated layer rather than an empty level.
- **AC-40** — GIVEN the Map view THEN the location breadcrumb (Nation, then
  the selected path) sits directly above the search box, inside the search
  card — in the sidebar on desktop and in the floating search card on phones
  — not in the header. It stays on one line and scrolls sideways when long,
  keeping the current crumb in view; the current crumb, other than Nation,
  is highlighted.
- **AC-6** — GIVEN a selected path WHEN the visitor clicks a breadcrumb crumb
  (or the "Nation" crumb) THEN the view returns to that ancestor's level (the
  Nation crumb returns to the broadest present layer) and the URL updates.
- **AC-7** — GIVEN the International sector is selected WHEN the visitor drills
  into any sub-level THEN every descendant org of that type is shown (not only
  direct children), because International's structure does not nest cleanly
  through the middle tiers.
- **AC-22** — GIVEN the API includes an intermediate org tier that the deployed
  homepage bundle does not recognize WHEN the homepage builds its hierarchy
  THEN it skips that tier and connects each recognized descendant to its nearest
  recognized ancestor, leaving no dangling parent references. For example, an
  area beneath an unknown territory remains reachable from its sector, along
  with its regions. Navigation and counts for recognized descendants continue
  working, and region AO pins and location panels retain the behavior specified
  in AC-17 and AC-18. Today's five-tier hierarchy behaves unchanged.

### URL state

- **AC-8** — GIVEN a deep link `?org=<id>` WHEN the map loads THEN it restores
  the view for that org; selecting a region via search writes the region's own
  id (not its parent area's) so the link reopens the region.
- **AC-9** — GIVEN a `?level=` value that names a navigable layer (e.g.
  `?level=regions`) THEN it is honored; a value naming a non-navigable type
  (`ao`/`nation`), an unrecognized name, or a numeric value is ignored rather
  than stranding the view.

### Search

- **AC-10** — GIVEN the visitor types a non-blank query THEN a result list
  opens combining instant client-side fuzzy matches across the navigable layers
  with server-searched **AO** matches (see AC-21); a blank query closes it; a
  non-blank query with no matches from either source shows a distinct "No
  matches" state.
- **AC-11** — GIVEN search results WHEN the visitor selects an org (click or
  Enter) THEN the map navigates to it and the list closes and stays closed —
  including after blurring and re-focusing the input, which must not resurface
  the prior partial-query matches. Selecting an **AO** result instead navigates
  to its region, shows that region's pins, and opens the AO's location panel
  (see AC-21).
- **AC-21** — GIVEN AOs are not part of the client dataset (the chart loads
  regions, not AOs) WHEN the visitor types (≥2 characters) THEN AO matches are
  fetched from `GET /v1/org-chart/aos?searchTerm=...` after a short debounce,
  superseded requests are aborted, and each hit shows the AO name with its
  region.
  Selecting one navigates to the AO's region, drops that region's pins, and
  opens the AO's busiest active location; only active AOs with active public
  events at active locations are returned.

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
  org's title, an AO's name, or a leader entry in either the org or the AO
  location panel THEN the corresponding identifiers (org/AO id/name/type, or
  user/position/role ids) are logged to the console as a quick lookup aid.

### AOs (leaf locations)

- **AC-17** — GIVEN the leaf layer (e.g. a region) WHEN the visitor clicks a
  region polygon THEN its active AO locations render as pins layered above the
  polygons and the panel shows that region's info (touch has no hover to load
  it first); while pins are shown, polygon-hover no longer swaps the info panel,
  and changing level, clicking a breadcrumb, or any polygon re-render clears the
  pins.
- **AC-18** — GIVEN AO pins are shown WHEN the visitor hovers or clicks a pin
  THEN the side panel shows that location's active AOs — each with name,
  active-event count, email/social links, and leadership positions; a load
  failure shows "Failed to load details." and a location with no active AOs
  shows an empty state. A late-arriving pin response never overrides a newer org
  or pin selection.
- **AC-19** — GIVEN multiple distinct AO locations share identical coordinates
  THEN their pins are fanned out around a small circle so each remains
  individually hoverable and clickable.

### Phone layout

- **AC-23** — GIVEN a viewport narrower than 768px that is upright or taller
  than 500px WHEN `/org` loads THEN the map fills the screen below a compact
  header (the title and Map / Table switcher, then one swipeable row of layer
  buttons), the search card — the breadcrumb (AC-40) above the search box —
  floats over the top of the map, and the info panel is a bottom sheet that
  shows a peek of the selected org or location and expands from its handle.
  Tapping a pin expands the sheet; tapping the map, a breadcrumb, a layer
  button, or another org collapses it. Map fits keep the focused orgs clear of
  the search box and the collapsed sheet, and the tile attribution stays
  visible. Each pin has a 32px square tap target; co-located pins fan out so
  their targets do not overlap and each opens its own location. On any
  touch-capable screen the search input stays at 16px so iOS Safari does not
  zoom on focus. Landscape screens up to 500px tall (sideways phones, at any
  width) use the side-by-side layout with a one-row header instead, since a
  bottom sheet would leave almost no map.

### API

- **AC-15** — GIVEN the org-chart endpoints are `protectedProcedure` WHEN the
  homepage client calls `GET /v1/org-chart`, `GET /v1/org-chart/{orgId}`,
  `GET /v1/org-chart/location/{locationId}`, `GET /v1/org-chart/aos`, or
  `GET /v1/org-chart/leadership` THEN
  it presents the read-only `NEXT_PUBLIC_ORG_MAP_API_KEY` as a Bearer token
  (plus the `client` header) and receives the directory data; a call with no
  valid key or session is rejected (UNAUTHORIZED), and requests are subject to
  the per-IP rate limit.
- **AC-20** — GIVEN the AO location endpoint WHEN the client calls
  `GET /v1/org-chart/location/{locationId}` THEN it returns the active
  location's active AOs (`orgType = "ao"`, active), their active-event counts,
  and active leadership only; an inactive location returns NOT_FOUND, and
  inactive orgs, events, and users are excluded across every org-chart read.
  Location/AO counts never double-count an AO across co-located records
  (records sharing coordinates merge, taking the max AO count).
- **AC-30** — GIVEN the leadership endpoint WHEN the client calls
  `GET /v1/org-chart/leadership` THEN it returns, in one response, every
  active org that is not an AO and whose ancestors are all active, whether or
  not it has active locations (id, name, type, parent id), and every position
  holder (active positions) and role holder at those orgs, each with its org
  id, kind (position or role), title, user id, F3 name, avatar URL, and home
  region name (null when the user has no home region or it is inactive);
  inactive orgs, orgs under an inactive ancestor, and inactive users are
  excluded.

## 5. Roles & authorization (RBAC)

The directory is **public, read-only, and requires no user account**. `/org` is
a static export, so it can't proxy calls server-side the way `apps/map` does;
instead the browser sends a **read-only API key** (`NEXT_PUBLIC_ORG_MAP_API_KEY`)
as a Bearer token on each org-chart request, plus a `client` header. The
org-chart read procedures stay **`protectedProcedure`** — the API key is the
trusted caller (`apps/map`'s equivalent browse endpoints moved to a
credential-free `publicReadProcedure` tier in #378; this directory's data
hasn't been re-tiered the same way). Because it is a
`NEXT_PUBLIC_*` var baked into the static bundle, the key is visible in devtools;
that is acceptable here because it is scoped to the read-only, already-public
org-chart directory data and grants nothing else.

| Action                                                                                    | Allowed                                                     | Explicitly denied                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Browse the directory map, search, view details                                            | Everyone, anonymous included (the app supplies the API key) | —                                           |
| Call `GET /v1/org-chart[/{id}]`, `/org-chart/location/{id}`, or `/org-chart/aos` directly | Callers presenting a valid API key or session               | Unauthenticated direct calls (UNAUTHORIZED) |
| Create / edit / delete any org data here                                                  | No one (feature is read-only)                               | All callers (no write endpoints exist)      |

All callers are subject to the in-memory per-IP rate limit (~500 req/min per
instance in production) — a per-instance limit, not a global cap.

Every read procedure (`all`, `byId`, `byLocation`, `aos`) returns **active
records only** — inactive orgs, locations, events, and users are excluded, so
the directory never surfaces deactivated orgs, venues, or people.

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
4. Search → select an org result → list closes and does not reopen on refocus
   with stale matches (AC-11). Typing also returns debounced AO matches from
   the server; selecting an AO navigates to its region and opens its location
   (AC-21).
5. An admin-less org surfaces the nearest ancestor admins; an inconclusive
   lookup shows the distinct "couldn't verify" message (AC-14).
6. The homepage client presents the API key and receives org-chart data; an
   unauthenticated direct call is rejected (AC-15).
7. Clicking a region reveals its AO pins; hovering/clicking a pin opens the
   location panel listing the active AOs there (AC-17, AC-18); co-located pins
   fan out so each is selectable (AC-19); the location endpoint returns only
   active AOs and leadership (AC-20).
8. Load a hierarchy containing an unrecognized intermediate tier: its children
   reconnect to the nearest recognized ancestor with no dangling parent IDs;
   drilling from sector to area to region, descendant counts, and region AO
   pins continue working (AC-22, AC-17, AC-18).
9. `/org` opens on the Map; switching to Table (nothing selected) lists only
   sector position and role holders from one leadership request (AC-39); picking a territory narrows the Area
   and Region dropdowns and the rows to that territory, and picking a region
   from search checks it and its ancestors in their filters; sorting by PAX
   orders rows by F3 name (AC-24–AC-31). Download CSV saves exactly the
   filtered, sorted rows, with formula-like values neutralized (AC-32).
10. Drill the Map to a territory and switch to Table: the territory and its
    sector are checked. Check two of its areas and switch to Map: the Map
    opens on the territory. Zoom the Map and refresh: the same territory opens
    at the same zoom. Refresh on the Table: the same filters stay checked
    (AC-33–AC-36).
11. In the Table, pick a territory where some areas or regions have no
    position holders: each such org appears once with "NO PAX LISTED" and
    "NO POSITIONS FILLED" in the placeholder style, the count adds "· M orgs
    with no positions filled", sorting by PAX keeps them last, and the CSV
    includes them; clearing the filters removes them (AC-38).

## 8. Observability

- The `/org` client is a static export and does not emit server logs. Client
  fetch failures surface as UI states, not console noise: the map shows
  "Failed to load: …", an org detail failure shows "Failed to load details.",
  and an inconclusive nearest-admin climb shows the "couldn't verify admins"
  message.
- Server side, the org-chart procedures log through `@acme/logger` on error via
  the shared API handler (`api.openapi.handler_error`).
- The info panel intentionally logs org and user identifiers to the browser
  console on click (org title, AO name, or leader entry, in either the org or
  the AO location panel) as an admin troubleshooting aid; this is deliberate and
  exposes only already-public directory ids.
