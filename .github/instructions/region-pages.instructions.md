---
applyTo: "apps/region-pages/**,packages/api/src/router/region-pages.ts,packages/api/src/lib/region-pages.ts"
---

# Region pages (`apps/region-pages`)

Public, anonymous, DB-free Next.js app. `apps/region-pages/AGENTS.md` is the
guide; `docs/specs/region-pages-directory.md` is the source of truth.

## Correctness

- Slugs are public URLs: lodash `kebabCase(name)`; the lowest org id wins a
  collision, in both list and detail paths. Reject any change to how slugs
  are built.
- Visibility matches the map: active, non-private, current series at an
  active location, under an active AO directly beneath an active region with
  active ancestors. Change it only in the API router, and update spec AC-7
  and the router tests in the same PR.
- Region org contact fields (email, website, social links) are public by
  design (spec § Roles & authorization). Don't flag them under the
  public-endpoint "no emails" rule.
- Empty regions render the "coming soon" page with contacts (200). Never
  404, never redirect home.
- Curated event dates are calendar days. Compare them as `YYYY-MM-DD`
  strings against today "anywhere on Earth" (UTC-12), and format a noon-UTC
  instant with `timeZone: "UTC"`. Never use a server-local `Date` for either.
- The series dedup key is a JSON tuple (region, name, day, time, location),
  not a delimited string; the highest id wins and near duplicates stay
  separate.

## Security

- Org-authored HTML renders only through `useSanitizedHtml`: the server and
  first client render are plain text, so calling `sanitizeHtmlToReactNodes`
  in render breaks hydration. Never use `dangerouslySetInnerHTML`.
  - When sanitizing leaves no text, render the default description
    (`useRegionDescription`), never the raw string.
  - Description links allow only http(s), `mailto:`, `tel:` and relative
    hrefs, with `rel="noopener noreferrer"`.
  - Regex-stripped text goes only into a text node.
- Social links are rebuilt from the parsed handle or host; the website must
  be http(s) (`httpUrlOrNull`). Never pass raw input as an `href`.
- Never key a cache or API call on an unvalidated slug: check it against the
  cached region list first. Cache keys are fixed strings, with no
  `Date.now()`, random or module-load fallbacks.

## Caching, build and config

- Nothing fetches at build time (the Docker build has no API access). The
  region page's `generateStaticParams` returns `[]`; `/`, `sitemap.ts` and
  `robots.ts` are `force-dynamic`.
- Route segment config (`revalidate`) is a numeric literal.
- A TTL change keeps worst-case staleness under the spec's budget (AC-13,
  computed in `src/lib/site.ts`). User-facing freshness copy must match it.
- Don't hide crawlable region links behind a `mounted` flag; server HTML must
  contain them.
- Config goes only through `src/env.ts`: no raw `process.env`, no
  `NEXT_PUBLIC_*`, nothing that throws at `next build`.
- A new logo host needs an `images.remotePatterns` entry (narrowest path,
  staging bucket included) and, if the host is new, the CSP `img-src`. Org
  images keep an `onError` fallback to the F3 logo.

## Content and styling

- No hard-coded region slugs or one-off promotions in components. Time-boxed
  content goes in `src/data/region-events.json` with dates and is removed
  after it expires.
- Tailwind v4 with OS (media) dark mode, and no `@acme/ui`.
  - Don't "fix" `shadow-xs`, `outline-hidden` or numeric utilities like
    `w-150` to v3 names.
  - Brand images need a dark-mode variant.
- A PR states any change to defaults or TTLs in its body.
