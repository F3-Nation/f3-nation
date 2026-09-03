/**
 * Isolated mount point for the Better Auth instance.
 *
 * Deliberately at /api/auth2/*, not /api/oauth/* or /api/auth/* — this must
 * not collide with either the hand-rolled OAuth server's routes or
 * NextAuth's own /api/auth/* callback routes, which stay live regardless of
 * AUTH_USE_BETTER_AUTH. See apps/auth/src/lib/better-auth.ts's file-level
 * comment for what rewiring the real /api/oauth/* endpoints to this instance
 * still needs.
 *
 * 404s entirely when the flag is off, rather than existing-but-erroring —
 * so there's no new attack surface or behavior change for anyone who hasn't
 * opted in.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "~/lib/better-auth";
import { env } from "~/env";

async function handle(request: NextRequest) {
  if (!env.AUTH_USE_BETTER_AUTH) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const auth = await getAuth();
  const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);
  switch (request.method) {
    case "GET":
      return GET(request);
    case "POST":
      return POST(request);
    case "PATCH":
      return PATCH(request);
    case "PUT":
      return PUT(request);
    case "DELETE":
      return DELETE(request);
    default:
      return NextResponse.json(
        { error: "method_not_allowed" },
        { status: 405 },
      );
  }
}

export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as PUT,
  handle as DELETE,
};
