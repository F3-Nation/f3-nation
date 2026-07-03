import type { NextFetchEvent, NextProxy, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { EDITOR_PATHS, routes } from "@acme/shared/app/constants";

import type { MiddlewareFactory } from "./types";
import { env } from "~/env";

const withEditor: MiddlewareFactory = (next: NextProxy) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    const res = await next(request, _next);

    if (!EDITOR_PATHS.includes(request.nextUrl.pathname)) {
      return res;
    }

    const [cookieToken] = request.cookies
      .getAll()
      .filter((o) => o.name.includes("authjs.session-token"));

    // Must use process.env so that we don't try to validate all the other envs
    const secret = env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set");

    if (!cookieToken) {
      return NextResponse.redirect(
        new URL(`${routes.auth.signIn.__path}?reason=no-cookie`, request.url),
      );
    }

    const payload = await getToken({
      req: request,
      secret,
      salt: cookieToken.name,
      cookieName: cookieToken.name,
    });

    const roles = (payload?.roles ?? []) as { roleName: string }[];
    const isEditorOrAdmin = roles.some(
      (role) => role.roleName === "editor" || role.roleName === "admin",
    );

    if (!isEditorOrAdmin) {
      return NextResponse.redirect(
        new URL(`${routes.auth.signIn.__path}?reason=not-editor`, request.url),
      );
    }

    return res;
  };
};

export default withEditor;
