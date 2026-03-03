import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getUser, updateUser } from "@/lib/api/client";

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = Number(session.sub);

    const body = (await request.json()) as {
      orgId: number;
      roleName: string;
    };

    if (!body.orgId || !body.roleName) {
      return NextResponse.json(
        { error: "orgId and roleName are required" },
        { status: 400 },
      );
    }

    // Fetch current user to get roles array
    const currentUser = await getUser(userId);

    // Filter out the specified role
    const filteredRoles = (currentUser.roles ?? []).filter(
      (role) => !(role.orgId === body.orgId && role.roleName === body.roleName),
    );

    // Update user with filtered roles
    const updatedUser = await updateUser({
      id: userId,
      roles: filteredRoles,
    });

    return NextResponse.json({ roles: updatedUser.roles });
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
