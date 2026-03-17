import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { auth } from "~/lib/auth";
import { db } from "~/lib/db";

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

  // Direct DB write — the F3 API's crupdate endpoint requires a `roles`
  // array that replaces existing roles, so a partial profile update would
  // risk wiping the user's roles. Same justification as emailVerified.
  const [user] = await db
    .select({ meta: users.meta })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const currentMeta = user?.meta ?? {};
  const updatedMeta = { ...currentMeta, onboarding_completed: true };

  await db
    .update(users)
    .set({
      f3Name: body.f3Name,
      firstName: body.firstName,
      lastName: body.lastName,
      meta: updatedMeta,
    })
    .where(eq(users.id, userId));

  return NextResponse.json({ success: true });
}
