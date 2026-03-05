import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getUserByEmail, updateUser } from "@/lib/api/client";
import type { UserMeta, ProfileUpdatePayload } from "@/lib/types";

const EDITABLE_FIELDS = new Set([
  "f3Name",
  "firstName",
  "lastName",
  "phone",
  "homeRegionId",
  "avatarUrl",
  "emergencyContact",
  "emergencyPhone",
  "emergencyNotes",
]);

const META_FIELDS = new Set([
  "f3_name_origin",
  "my_f3_why",
  "user_emergency_info_dr_sharing",
  "start_date_override",
]);

export async function GET() {
  try {
    const session = await requireAuth();
    const user = await getUserByEmail(session.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(user);
  } catch (err) {
    console.error("Failed to fetch profile:", err);
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    const currentUser = await getUserByEmail(session.email);
    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = currentUser.id;

    const body = (await request.json()) as ProfileUpdatePayload;

    // Separate regular fields from meta fields
    const updateBody: Record<string, unknown> = { id: userId };
    const metaUpdates: Partial<UserMeta> = {};

    for (const [key, value] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(key)) {
        updateBody[key] = value;
      } else if (META_FIELDS.has(key)) {
        metaUpdates[key] = value;
      }
      // Silently ignore unrecognized fields
    }

    // Handle meta field updates — merge with existing meta
    if (Object.keys(metaUpdates).length > 0) {
      let existingMeta: UserMeta = {};
      if (currentUser.meta) {
        if (typeof currentUser.meta === "object") {
          existingMeta = currentUser.meta as UserMeta;
        } else {
          try {
            existingMeta = JSON.parse(currentUser.meta) as UserMeta;
          } catch {
            existingMeta = {};
          }
        }
      }

      // Merge: preserve all existing keys, update only the editable ones
      const mergedMeta = { ...existingMeta, ...metaUpdates };
      updateBody.meta = JSON.stringify(mergedMeta);
    }

    // The API's CrupdateUserSchema requires `roles` — pass existing roles through
    updateBody.roles = (currentUser.roles ?? []).map((r) => ({
      orgId: r.orgId,
      roleName: r.roleName,
    }));

    const updatedUser = await updateUser(updateBody);
    return NextResponse.json(updatedUser);
  } catch (err) {
    console.error("Failed to update profile:", err);
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 },
    );
  }
}
