import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { canonicalRedirect } from "@/lib/redirect";
import { nonEmpty } from "@/lib/site";

export function proxy(request: NextRequest) {
  // Only an explicit SITE_URL activates the redirect; the getSiteUrl()
  // production fallback must not turn it on before cutover step 4.
  const siteUrl = nonEmpty(env.SITE_URL);
  if (!siteUrl) return NextResponse.next();
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const target = canonicalRedirect(host, request.nextUrl, siteUrl);
  if (!target) return NextResponse.next();
  const status = Number(env.REGIONS2_REDIRECT_STATUS);
  const res = NextResponse.redirect(target, status);
  // A temporary redirect must not be cached, so rollback takes effect at once.
  if (status === 307) res.headers.set("cache-control", "no-store");
  return res;
}

export const config = {
  matcher: ["/((?!_next/).*)"],
};
