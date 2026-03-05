import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getUserByEmail, updateUser } from "@/lib/api/client";

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();

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
    const currentUser = await getUserByEmail(session.email);
    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Filter out the specified role
    const filteredRoles = (currentUser.roles ?? []).filter(
      (role) => !(role.orgId === body.orgId && role.roleName === body.roleName),
    );

    // Update user with filtered roles
    const updatedUser = await updateUser({
      id: currentUser.id,
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
