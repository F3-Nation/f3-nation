import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getUsers } from "@/lib/api/client";
import { logError } from "@/lib/logging";

const MAX_RESULTS = 500;

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

    const homeRegionId = request.nextUrl.searchParams.get("homeRegionId");
    const hasHomeRegionId = homeRegionId !== null;
    const parsed =
      hasHomeRegionId && homeRegionId.trim() !== ""
        ? Number(homeRegionId)
        : undefined;
    if (
      hasHomeRegionId &&
      (!parsed || !Number.isInteger(parsed) || parsed < 1)
    ) {
      return NextResponse.json(
        { error: "homeRegionId must be a positive integer" },
        { status: 400 },
      );
    }

    const searchTerm = request.nextUrl.searchParams.get("searchTerm")?.trim();
    if (searchTerm && searchTerm.length < 2) {
      return NextResponse.json(
        { error: "searchTerm must be at least 2 characters" },
        { status: 400 },
      );
    }

    const users = await getUsers({
      userId: parsedUserId,
      homeRegionId: parsed,
      searchTerm,
    });

    // Cap results to prevent unbounded response payloads at scale
    return NextResponse.json({ users: users.slice(0, MAX_RESULTS) });
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
