import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { deleteMyRole } from "@/lib/api/client";

export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();

    const body = (await request.json()) as {
      orgId: number;
      roleId: number;
    };

    if (
      body.orgId == null ||
      typeof body.orgId !== "number" ||
      body.roleId == null ||
      typeof body.roleId !== "number"
    ) {
      return NextResponse.json(
        { error: "orgId and roleId are required" },
        { status: 400 },
      );
    }

    const result = await deleteMyRole(body.orgId, body.roleId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to remove role:", err);
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;
    return NextResponse.json(
      { error: "Failed to remove role" },
      { status: 500 },
    );
  }
}
