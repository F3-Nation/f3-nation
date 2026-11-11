import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { canonicalRedirect } from "@/lib/redirect";
import { getSiteUrl } from "@/lib/site";

export function proxy(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const target = canonicalRedirect(host, request.nextUrl, getSiteUrl());
  return target
    ? NextResponse.redirect(target, Number(env.REGIONS2_REDIRECT_STATUS))
    : NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/).*)"],
};
