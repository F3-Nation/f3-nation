import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { deleteMyPosition } from "@/lib/api/client";

export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();

    const body = (await request.json()) as {
      orgId: number;
      positionId: number;
    };

    if (
      body.orgId == null ||
      typeof body.orgId !== "number" ||
      body.positionId == null ||
      typeof body.positionId !== "number"
    ) {
      return NextResponse.json(
        { error: "orgId and positionId are required" },
        { status: 400 },
      );
    }

    const result = await deleteMyPosition(body.orgId, body.positionId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to remove position:", err);
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;
    return NextResponse.json(
      { error: "Failed to remove position" },
      { status: 500 },
    );
  }
}
