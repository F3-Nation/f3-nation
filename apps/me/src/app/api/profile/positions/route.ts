import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import {
  getUserByEmail,
  getPositionAssignments,
  updatePositionAssignments,
} from "@/lib/api/client";

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    const user = await getUserByEmail(session.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = user.id;

    const body = (await request.json()) as {
      orgId: number;
      positionId: number;
    };

    if (!body.orgId || !body.positionId) {
      return NextResponse.json(
        { error: "orgId and positionId are required" },
        { status: 400 },
      );
    }

    // Fetch current position assignments for the org
    const orgAssignments = await getPositionAssignments(body.orgId);

    // Remove the user's ID from the specified position's userIds
    const updatedAssignments = orgAssignments.assignments.map((assignment) => {
      if (assignment.positionId === body.positionId) {
        return {
          positionId: assignment.positionId,
          userIds: assignment.userIds.filter((uid) => uid !== userId),
        };
      }
      return {
        positionId: assignment.positionId,
        userIds: assignment.userIds,
      };
    });

    // Update position assignments (preserves all other users' assignments)
    await updatePositionAssignments(body.orgId, updatedAssignments);

    return NextResponse.json({ success: true });
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
