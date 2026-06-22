import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { db } from "~/lib/db";
import { rateLimit } from "~/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  const { allowed } = rateLimit(`check-user:${ip}`, 5, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await request.json()) as { email?: string };

  if (!body.email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const email = body.email.toLowerCase().trim();

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return NextResponse.json({ exists: !!user });
}
