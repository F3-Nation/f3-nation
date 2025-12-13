import type { JWT } from "next-auth";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { env } from "@acme/env";
import { ADMIN_PATHS, routes } from "@acme/shared/app/constants";
import { COOKIE_NAME } from "@acme/shared/common/constants";

import type { MiddlewareFactory } from "./types";

const withAdmin: MiddlewareFactory = (next: NextMiddleware) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    const res = await next(request, _next);

    if (!ADMIN_PATHS.includes(request.nextUrl.pathname)) {
      return res;
    }

    const [cookieToken] = request.cookies
      .getAll()
      .filter((o) => o.name.includes(`${COOKIE_NAME}.session-token`));

    // Must use process.env so that we don't try to validate all the other envs
    const secret = env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set");

    if (!cookieToken) {
      return NextResponse.redirect(
        new URL(`${routes.auth.signIn.__path}?reason=no-cookie`, request.url),
      );
    }

    const payload: JWT | null = await getToken({
      req: request,
      secret,
      salt: cookieToken.name,
      cookieName: cookieToken.name,
    });

    const isAdmin = payload?.roles.some((role) => role.roleName === "admin");

    if (!isAdmin) {
      return NextResponse.redirect(
        new URL(`${routes.auth.signIn.__path}?reason=not-admin`, request.url),
      );
    }

    return res;
  };
};

export default withAdmin;
