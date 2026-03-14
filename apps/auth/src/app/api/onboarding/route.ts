import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { authOptions } from "~/lib/auth-options";
import { db } from "~/lib/db";
import { env } from "~/env";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    f3Name?: string;
    firstName?: string;
    lastName?: string;
  };

  if (!body.f3Name || !body.firstName || !body.lastName) {
    return NextResponse.json(
      { error: "f3Name, firstName, and lastName are required" },
      { status: 400 },
    );
  }

  // Update user profile via F3 API
  try {
    const res = await fetch(
      `${env.F3_API_BASE_URL}/api/users/${session.user.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.F3_API_KEY,
        },
        body: JSON.stringify({
          f3Name: body.f3Name,
          firstName: body.firstName,
          lastName: body.lastName,
        }),
      },
    );

    if (!res.ok) {
      console.error("Failed to update user via API:", await res.text());
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("Error updating user:", err);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 502 },
    );
  }

  // Set onboarding_completed in meta
  const [user] = await db
    .select({ meta: users.meta })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const currentMeta = (user?.meta ?? {}) as Record<string, unknown>;
  const updatedMeta = { ...currentMeta, onboarding_completed: true };

  await db
    .update(users)
    .set({ meta: updatedMeta })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ success: true });
}
