import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { validateAccessToken } from "~/lib/oauth";
import { rateLimit } from "~/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  const { allowed } = rateLimit(`userinfo:${ip}`, 60, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const result = await validateAccessToken(token);

  if (!result) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const scopes = new Set((result.scopes ?? "").split(" "));
  const claims: Record<string, unknown> = {
    // OIDC Core §2 requires sub to be a string, and §5.3.2 requires an RP to
    // verify this exactly matches the ID Token's sub (also a string, see
    // signIdToken) — a numeric sub here would fail that comparison in any
    // conformant client and get the whole response discarded.
    sub: String(result.user.id),
  };

  if (scopes.has("profile")) {
    claims.name = result.user.f3Name;
    claims.picture = result.user.avatarUrl;
  }

  if (scopes.has("email")) {
    claims.email = result.user.email;
    claims.email_verified = !!result.user.emailVerified;
  }

  return NextResponse.json(claims);
}
