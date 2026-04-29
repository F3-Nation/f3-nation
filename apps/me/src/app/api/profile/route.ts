import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/server";
import { getMyProfile, updateMyProfile } from "@/lib/api/client";
import type { UserMeta } from "@/lib/types";

const profileUpdateSchema = z
  .object({
    // Regular editable fields
    f3Name: z.string().min(1).max(200).optional(),
    firstName: z.string().max(200).nullable().optional(),
    lastName: z.string().max(200).optional(),
    phone: z.string().max(50).nullable().optional(),
    homeRegionId: z.number().int().positive().nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    emergencyContact: z.string().max(200).nullable().optional(),
    emergencyPhone: z.string().max(50).nullable().optional(),
    emergencyNotes: z.string().max(1000).nullable().optional(),
    // Meta sub-fields
    f3_name_origin: z.string().max(1000).optional(),
    my_f3_why: z.string().max(2000).optional(),
    user_emergency_info_dr_sharing: z.boolean().optional(),
    start_date_override: z.string().max(50).optional(),
    brought_by: z.number().int().positive().nullable().optional(),
  })
  .strict();

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
  "brought_by",
]);

export async function GET() {
  try {
    await requireAuth();
    const user = await getMyProfile();
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
    await requireAuth();

    const raw: unknown = await request.json();
    const parsed = profileUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Separate regular fields from meta fields
    const updateBody: Record<string, unknown> = {};
    const metaUpdates: Partial<UserMeta> = {};

    for (const [key, value] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(key)) {
        updateBody[key] = value;
      } else if (META_FIELDS.has(key)) {
        metaUpdates[key] = value;
      }
    }

    // Pass meta fields to the API — the me router merges them with existing meta
    if (Object.keys(metaUpdates).length > 0) {
      updateBody.meta = metaUpdates;
    }

    const updatedUser = await updateMyProfile(updateBody);
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
