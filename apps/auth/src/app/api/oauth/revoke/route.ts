import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { forwardToBetterAuth } from "~/lib/better-auth-oauth";
import { revokeToken } from "~/lib/oauth";
import { rateLimit } from "~/lib/rate-limit";
import { env } from "~/env";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  const { allowed } = rateLimit(`revoke:${ip}`, 30, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Unlike the hand-rolled route (unauthenticated, refresh tokens only),
  // Better Auth requires client authentication (RFC 7009 §2.1): relying
  // parties must send client_id and client_secret, in the body or as Basic.
  // A request without them is rejected.
  if (env.AUTH_USE_BETTER_AUTH) {
    return forwardToBetterAuth(request, "revoke", { dropCookies: true });
  }

  const formData = await request.formData();
  const token = formData.get("token") as string | null;

  if (!token) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  await revokeToken(token);

  // RFC 7009: always return 200 regardless of whether token existed
  return NextResponse.json({ revoked: true });
}
