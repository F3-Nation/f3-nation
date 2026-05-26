import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Canonical-host enforcement (SEO).
 *
 * region-pages is reachable from several domains (e.g. the historical
 * f3regions.com / f3region.info and the canonical regions.f3nation.com). To
 * consolidate link equity and avoid duplicate-content indexing, every request
 * whose Host is NOT the canonical host is permanently redirected (308) to the
 * same path+query on the canonical host. Pair this with the per-page
 * `alternates.canonical` tags (see generateMetadata) for belt-and-suspenders
 * canonicalization.
 *
 * Opt-in and inert by default: it only redirects when NEXT_PUBLIC_CANONICAL_HOST
 * is set. Until the canonical domain (regions.f3nation.com) is cut over, leave
 * it unset and every host serves normally.
 */
const CANONICAL_HOST = process.env.NEXT_PUBLIC_CANONICAL_HOST?.trim();

export function middleware(request: NextRequest): NextResponse {
  // Inert until a canonical host is configured.
  if (!CANONICAL_HOST) return NextResponse.next();

  // `host` includes the port in local dev; compare hostname only.
  const host = request.headers.get('host');
  if (!host) return NextResponse.next();
  const hostname = host.split(':')[0];

  if (hostname === CANONICAL_HOST) return NextResponse.next();

  // 308 = permanent + method-preserving; same SEO signal as 301. Preserve the
  // full path and query so deep links transfer to the canonical domain.
  const target = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    `https://${CANONICAL_HOST}`
  );
  return NextResponse.redirect(target, 308);
}

export const config = {
  /**
   * Skip Next internals, static assets, and the cron ingest endpoint. The
   * `/api/ingest` route is excluded so QStash cron (which posts to a fixed URL
   * and may not follow redirects) keeps working regardless of which host it
   * targets; indexable HTML pages are still redirected to the canonical host.
   */
  matcher: ['/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml).*)'],
};
