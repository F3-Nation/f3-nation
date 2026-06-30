import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/server";
import { deleteMyPosition } from "@/lib/api/client";
import { logError } from "@/lib/logging";

const deletePositionSchema = z.strictObject({
  orgId: z.number().int().positive(),
  positionId: z.number().int().positive(),
});

export async function DELETE(request: NextRequest) {
  let sessionUserId: number | undefined;

  try {
    const session = await requireAuth();
    sessionUserId = session.userId;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = deletePositionSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "orgId and positionId are required (positive integers)" },
        { status: 400 },
      );
    }

    const result = await deleteMyPosition(
      parsed.data.orgId,
      parsed.data.positionId,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;

    logError(
      "me.profile_positions.delete_failed",
      {
        sessionUserId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      },
      err,
    );

    return NextResponse.json(
      { error: "Failed to remove position" },
      { status: 500 },
    );
  }
}
