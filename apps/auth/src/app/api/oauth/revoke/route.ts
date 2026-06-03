import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { revokeToken } from "~/lib/oauth";
import { rateLimit } from "~/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed } = rateLimit(`revoke:${ip}`, 30, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
