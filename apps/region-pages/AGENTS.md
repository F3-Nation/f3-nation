<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# F3 Region Pages — Agent Guide

Public directory of F3 regions and their weekly workouts
(`regions.f3nation.com`). Spec: [`docs/specs/region-pages-directory.md`](../../docs/specs/region-pages-directory.md).

## Architecture

- **No database access.** All data comes from the public `regionPages.*`
  oRPC procedures on apps/api (`packages/api/src/router/region-pages.ts`) via
  `src/lib/api.ts`, identified by the `f3-region-pages` client header.
  Shaping (slugs, social URLs, time format, dedup, region area) lives in
  `packages/api/src/lib/region-pages.ts`.
- **Caching.** `src/lib/data.ts` wraps API reads in `unstable_cache` for
  `REVALIDATE_SECONDS` (1 h). Region pages are on-demand ISR
  (`generateStaticParams` returns `[]`); `/` and `/sitemap.xml` render per
  request from the cached data. Nothing fetches at image build time.
- **Env.** `SITE_URL` and `GA_MEASUREMENT_ID` are deliberately server-only
  (not `NEXT_PUBLIC_*`): Next inlines `NEXT_PUBLIC_*` at build, and one image
  serves both staging and prod.
- **Styling.** Plain Tailwind v4 with OS-driven (media) dark mode, carried
  over from the legacy app; it does not use `@acme/ui` or
  `@acme/tailwind-config`'s class-based dark mode.
- **Curated events.** `src/data/region-events.json` is hand-maintained.

## Local dev

```bash
pnpm -F f3-region-pages dev
```

Needs apps/api running (`F3_API_BASE_URL` in `.env`, default
`http://localhost:3001/v1`). Port: `F3_REGION_PAGES_PORT` (default 3006).
