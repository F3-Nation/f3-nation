import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { and, eq } from "@acme/db";
import { orgs, users } from "@acme/db/schema/schema";

import { getCurrentSession } from "~/lib/current-session";
import { db } from "~/lib/db";

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = Number(session.user.id);
  const [user] = await db
    .select({
      f3Name: users.f3Name,
      firstName: users.firstName,
      lastName: users.lastName,
      homeRegionId: users.homeRegionId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const isExistingUser = !!(user?.f3Name ?? user?.firstName ?? user?.lastName);

  return NextResponse.json({
    f3Name: user?.f3Name ?? "",
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    homeRegionId: user?.homeRegionId ?? null,
    isExistingUser,
  });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = Number(session.user.id);

  const body = (await request.json()) as {
    f3Name?: string;
    firstName?: string;
    lastName?: string;
    homeRegionId?: number | null;
  };

  if (!body.f3Name || !body.firstName || !body.lastName) {
    return NextResponse.json(
      { error: "f3Name, firstName, and lastName are required" },
      { status: 400 },
    );
  }

  // The home region is optional here so a page loaded before this field
  // existed can still finish onboarding. When one is sent it has to be an
  // active region, the same set /api/regions offers.
  const homeRegionId = body.homeRegionId ?? null;
  if (homeRegionId !== null) {
    const [region] = Number.isInteger(homeRegionId)
      ? await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(
            and(
              eq(orgs.id, homeRegionId),
              eq(orgs.orgType, "region"),
              eq(orgs.isActive, true),
            ),
          )
          .limit(1)
      : [];
    if (!region) {
      return NextResponse.json(
        { error: "homeRegionId must be an active region" },
        { status: 400 },
      );
    }
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
  // A timestamp so we can tell when someone last confirmed their
  // profile.
  const updatedMeta = {
    ...currentMeta,
    onboarding_completed: new Date().toISOString(),
  };

  await db
    .update(users)
    .set({
      f3Name: body.f3Name,
      firstName: body.firstName,
      lastName: body.lastName,
      ...(homeRegionId !== null && { homeRegionId }),
      meta: updatedMeta,
    })
    .where(eq(users.id, userId));

  return NextResponse.json({ success: true });
}
