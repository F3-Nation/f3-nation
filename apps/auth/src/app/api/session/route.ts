import { NextResponse } from "next/server";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { auth } from "~/lib/auth";
import { db } from "~/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = Number(session.user.id);

  const [user] = await db
    .select({
      id: users.id,
      f3Name: users.f3Name,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      meta: users.meta,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const meta = (user.meta ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    user: {
      id: user.id,
      f3Name: user.f3Name,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status,
      onboardingCompleted: !!meta.onboarding_completed,
    },
  });
}
