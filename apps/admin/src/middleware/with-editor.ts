import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { EDITOR_PATHS } from "@acme/shared/app/constants";

import { ACCESS_TOKEN_COOKIE_NAME } from "~/lib/auth/constants";
import { verifyAccessTokenPayload } from "~/lib/auth/tokens";

import type { MiddlewareFactory } from "./types";

const withEditor: MiddlewareFactory = (next: NextMiddleware) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    const res = await next(request, _next);

    if (!EDITOR_PATHS.includes(request.nextUrl.pathname)) {
      return res;
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    if (!accessToken) {
      return NextResponse.redirect(
        new URL(
          `/api/auth/login?returnTo=${encodeURIComponent(
            request.nextUrl.pathname + request.nextUrl.search,
          )}`,
          request.url,
        ),
      );
    }

    const payload = await verifyAccessTokenPayload(accessToken);
    if (!payload) {
      return NextResponse.redirect(
        new URL(
          `/api/auth/login?returnTo=${encodeURIComponent(
            request.nextUrl.pathname + request.nextUrl.search,
          )}`,
          request.url,
        ),
      );
    }

    return res;
  };
};

export default withEditor;
