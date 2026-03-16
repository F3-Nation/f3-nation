import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { auth } from "~/lib/auth";
import { db } from "~/lib/db";
import { env } from "~/env";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = Number(session.user.id);

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
    const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.API_KEY,
      },
      body: JSON.stringify({
        f3Name: body.f3Name,
        firstName: body.firstName,
        lastName: body.lastName,
      }),
    });

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
    .where(eq(users.id, userId))
    .limit(1);

  const currentMeta = (user?.meta ?? {}) as Record<string, unknown>;
  const updatedMeta = { ...currentMeta, onboarding_completed: true };

  await db.update(users).set({ meta: updatedMeta }).where(eq(users.id, userId));

  return NextResponse.json({ success: true });
}
