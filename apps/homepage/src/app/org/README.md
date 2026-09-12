# `/org` — F3 Geographic Directory

An interactive Leaflet map of F3 Nation's org hierarchy (sectors → areas →
regions → AOs). It is a single client-rendered route inside the otherwise-static
homepage export: the page shell is prerendered at build time, and all data is
fetched in the browser from the public API.

See [`specs/org-directory-map.md`](../../../../../specs/org-directory-map.md) for
the product spec (what it does, who may do it, how it's verified).

## How it fits the static export

The homepage uses `output: "export"`, so this route cannot use server
components, API routes, or server-side data fetching. Instead:

- `page.tsx` renders `OrgMapLoader`, a client component that `dynamic()`-imports
  the real map with `ssr: false` (Leaflet touches `window`, so it must never run
  during the static build).
- All data comes from the browser via `_lib/api.ts`, which calls the public API.

## Data fetching & auth

`_lib/api.ts` hits two `protectedProcedure` endpoints, so requests carry a
read-only Bearer key plus a `client` header:

- `GET /v1/org-chart` — the full directory (`fetchOrgChart`)
- `GET /v1/org-chart/:id` — one org's detail (`fetchOrgById`)

The key is `NEXT_PUBLIC_ORG_MAP_API_KEY`. Because this is a static bundle, that
value is **baked in at build time and visible in devtools** — it is intentionally
scoped so it grants nothing beyond the public org-chart reads. The API base
resolves from `NEXT_PUBLIC_API_URL` (falling back to localhost in dev, else
`https://api.f3nation.com`). See the repo-root
[`apps/homepage/README.md`](../../../README.md#environment-variables) for the env
var table.

## Layout

```text
org/
├── page.tsx            # Route entry: metadata + <OrgMapLoader/>
├── _components/
│   ├── org-map-loader.tsx  # Client wrapper, dynamic ssr:false import of the map
│   ├── org-map.tsx         # The Leaflet map, layer navigation, and overlays
│   ├── org-info-panel.tsx  # Detail panel for a selected org
│   └── search-box.tsx      # Fuzzy org search
└── _lib/
    ├── api.ts          # Browser fetch helpers + auth headers
    ├── types.ts        # OrgChartItem / OrgDetail / Org shapes (OrgType re-exported)
    ├── org-chart.ts    # Build the hierarchy; org-type ordering & ranks
    ├── navigation.ts   # Level/descendant traversal, path helpers
    ├── url-state.ts    # Read/write ?level=&org= query state (shareable links)
    └── geo-utils.ts    # Convex hulls, buffers, fuzzy scoring, area math
```

Underscore-prefixed folders are Next.js "private folders" — they are not routable,
so `_lib` and `_components` never become URL segments.

## Conventions worth knowing

- **Org types are data-driven.** The tier order comes from
  `@acme/shared/app/enums`; `org-chart.ts` derives `LAYER_TYPES` and
  `orgTypeRank` from it, so adding a tier upstream (e.g. "territory") flows
  through navigation and level buttons without edits here.
- **`normalizeOrgType` returns `null` for unknown values** rather than a
  fallback — unrecognized types must not be silently coerced into a valid-looking
  one.
- **URL state is shareable.** `url-state.ts` keeps `?level=&org=` in sync via
  `history.replaceState`; the top level (`sector`) is omitted from the URL as the
  default.

## Tests

Each `_lib` module has a co-located `*.test.ts`, and the components have
`*.test.tsx`. Run them with:

```bash
pnpm test --filter f3-homepage
```
