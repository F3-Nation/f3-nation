# Map browse, search & location detail

> Human designer: Declan Nishiyama (@dnishiyama)

## 1. Summary

Anyone — no account required — can open the F3 map, see every active public
workout location as pins/clusters, search by place, region, AO, or workout
name, filter by day/time/type, and open a location's detail panel to find out
what, where, and when a workout happens (with directions and contact links).
This is the core discovery experience: a visitor should get from "I'm in
city X" to "this workout, this address, this time" in a few interactions.

## 2. Context & links

- App(s) affected: **map** (UI), **api** (`packages/api` map/event routers).
- Key code: `apps/map/src/app/page.tsx` (SSG + ISR),
  `apps/map/src/app/_components/map/` (Google map, search, panels, filters),
  `apps/map/src/app/_components/marker-clusters/`,
  `packages/api/src/router/map/location.ts`,
  `apps/map/src/app/api/orpc/[[...rest]]/route.ts` (API-key proxy),
  `apps/map/src/app/api/revalidate/route.ts`.

## 3. User stories

- As a **visitor (no account)**, I want to see workouts near a place I search
  so that I can find my first F3 workout.
- As a **traveling PAX**, I want to filter by day and time so that I can find
  a workout that fits my schedule this week.
- As a **PAX sharing a workout**, I want a copyable link to a specific event
  so that the recipient lands on the right location.

## 4. Acceptance criteria (testable, non-contradictory)

### Load & render

- **AC-1** — GIVEN an anonymous visitor WHEN the map app loads THEN the map
  renders (`data-testid="map"`) with workout pins/clusters visible at the
  default view, with no sign-in prompt or auth redirect.
- **AC-2** — GIVEN the map is loaded THEN the search box placeholder shows the
  live workout count ("Search N free, peer-led workouts", falling back to
  "5000+" until loaded).
- **AC-3** — GIVEN a zoomed-out view with a cluster bubble showing a count
  WHEN the user clicks the cluster THEN the map zooms toward its contents and
  the cluster splits into smaller clusters or individual pins.

### Search

- **AC-4** — GIVEN the user types 2+ characters in the search box THEN a
  results popover (`data-testid="map-searchbox-popover-content-desktop"`)
  shows **F3 Workouts** and **F3 Regions** matches; the **Places** (geocoded)
  group fills in at 3+ characters. All three kinds are toggleable; unchecking
  a kind removes its rows.
- **AC-5** — GIVEN search results WHEN the user selects an F3 workout result
  THEN the map pans/zooms to that location and it becomes the selected item
  (`data-testid="selected-item-desktop"` on desktop).
- **AC-6** — GIVEN search results WHEN the user selects a Places (geocoded)
  result THEN the map pans/zooms to that area and no location panel opens.
- **AC-7** — GIVEN search results are navigable by keyboard THEN ArrowUp/Down
  move focus and Enter activates the focused result.

### Location detail

- **AC-8** — GIVEN a visible pin WHEN the user clicks it (desktop) THEN the
  location panel opens (`data-testid="panel"`) showing the workout name, event
  type(s), address with a Google Maps directions link, schedule (day/time),
  and region section; a close control dismisses it.
- **AC-9** — GIVEN a location with multiple workouts WHEN its panel is open
  THEN all of that location's workouts are listed and selectable as chips.
- **AC-10** — GIVEN an open location panel WHEN the user clicks "Copy Link to
  Event" THEN a URL containing `locationId` and `eventId` is copied, and
  opening that URL loads the map centered on that location.
- **AC-11** — GIVEN a location whose data is missing/removed WHEN its detail
  is requested THEN the panel shows a not-available message rather than an
  error page.

### Filters

- **AC-12** — GIVEN pins are visible WHEN the user activates a day filter
  (e.g. "Today") THEN only locations with at least one matching event remain
  on the map; when nothing matches, the nearby list shows a "No locations
  found" empty state. (The "matching your filters" suffix is added only for
  day, event-type, and specific-time filters — AM/PM don't add it.)
- **AC-13** — GIVEN the AM quick filter is active WHEN the user activates PM
  THEN AM deactivates (mutually exclusive), and Reset restores the unfiltered
  pin set.

### Geolocation

- **AC-14** — GIVEN the user grants location permission WHEN they press the
  "My Location" control THEN the map centers on their position at street-level
  zoom and a location marker (`data-testid="geolocation-marker"`) renders;
  denied permission leaves the map view unchanged and shows the control in a
  muted/disabled visual state rather than erroring.

## 5. Roles & authorization (RBAC)

Browsing is anonymous by design. The map **API read procedures are
`protectedProcedure`, not `publicProcedure`**: the map app itself is the
trusted caller. Server-side (SSG) calls and the browser's `/api/orpc` proxy
inject `F3_MAP_API_KEY` (the proxy strips any inbound auth headers first), so
the end user never authenticates.

| Action                                                     | Allowed                                                         | Explicitly denied                           |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| Browse map, search, view location detail (via the map app) | Everyone, anonymous included                                    | —                                           |
| Call map read procedures directly (no credential)          | Trusted callers holding the map API key; authenticated sessions | Unauthenticated direct calls (UNAUTHORIZED) |
| Trigger cache revalidation (`/api/revalidate`)             | Internal callers with `SUPER_ADMIN_API_KEY`; nation admins      | Everyone else                               |

All callers are subject to an in-memory per-IP rate limit (~200 req/min per
instance in production; requests without a forwarded client IP fall into a
shared "anonymous" bucket) — a per-instance limit, not a global cap.

## 6. Data & migrations

- None — read-only feature. Reads exclude inactive and non-public **events**
  and inactive **locations** (pinned by
  `packages/api/src/router/map/location.test.ts`). Known gap: events under a
  deactivated **AO** are not yet excluded (the `aoOrg` join has no `isActive`
  filter) — flagged for a separate code fix + test.

## 7. Out of scope / non-goals

- Edit mode and update requests (documented in the map edit-flow spec that
  ships with that feature).
- Region landing pages (`region-pages` app) and the homepage.
- Mobile-app-specific behavior beyond the responsive mobile web layout.
- Making map read procedures public (with per-read source recording) — a
  possible future change with its own review; this spec pins current behavior.

## 8. Critical-path test cases

1. Anonymous map load renders pins/clusters, no auth wall (AC-1).
2. Search for a known AO/workout → select → map navigates to it (AC-5).
3. Pin click opens the detail panel with name, address/directions, and
   schedule (AC-8).
4. AM/PM filter visibly changes the pin/nearby set; reset restores it
   (AC-12/13).
5. Copied event link reopens centered on that location (AC-10).

## 9. Observability

- Today: `revalidate` endpoints log warm-up success/failure; standard request
  logs otherwise.
- To add (with the OTEL baseline work): page-load timing for the map route
  (SSG hit vs dynamic render), `map.revalidate.triggered` /
  `map.revalidate.warmed`, search-to-selection funnel counts, and
  `locationWorkout` latency.
