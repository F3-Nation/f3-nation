import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getUsers } from "@/lib/api/client";
import { logError } from "@/lib/logging";

export async function GET(request: NextRequest) {
  let sessionUserId: number | undefined;

  try {
    const session = await requireAuth();
    sessionUserId = session.userId;

    const userId = request.nextUrl.searchParams.get("userId");
    const hasUserId = userId !== null;
    const parsedUserId =
      hasUserId && userId.trim() !== "" ? Number(userId) : undefined;
    if (
      hasUserId &&
      (!parsedUserId || !Number.isInteger(parsedUserId) || parsedUserId < 1)
    ) {
      return NextResponse.json(
        { error: "userId must be a positive integer" },
        { status: 400 },
      );
    }

    const searchTerm = request.nextUrl.searchParams.get("searchTerm")?.trim();
    if (searchTerm !== undefined && searchTerm.length < 2) {
      return NextResponse.json(
        { error: "searchTerm must be at least 2 characters" },
        { status: 400 },
      );
    }

    if (!parsedUserId && !searchTerm) {
      return NextResponse.json(
        { error: "Either userId or searchTerm is required" },
        { status: 400 },
      );
    }

    const users = await getUsers({
      userId: parsedUserId,
      searchTerm,
    });

    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;

    logError(
      "me.users.fetch_failed",
      {
        sessionUserId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      },
      err,
    );

    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 },
    );
  }
}
