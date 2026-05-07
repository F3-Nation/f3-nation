import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/server";
import { deleteMyRole } from "@/lib/api/client";

const deleteRoleSchema = z
  .object({
    orgId: z.number().int().positive(),
    roleId: z.number().int().positive(),
  })
  .strict();

export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = deleteRoleSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "orgId and roleId are required (positive integers)" },
        { status: 400 },
      );
    }

    const result = await deleteMyRole(parsed.data.orgId, parsed.data.roleId);
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
