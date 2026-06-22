import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { auth } from "@acme/auth";
import { isNationAdminFromSession } from "@acme/shared/app/role-checks";
import { env } from "~/env";

export async function POST(request: Request) {
  try {
    // Check for internal API key authentication (from API app)
    const apiKey = request.headers.get("x-api-key");
    const isInternalRequest = apiKey === env.SUPER_ADMIN_API_KEY;

    if (!isInternalRequest) {
      console.log("This is not an internal request. Checking session");

      // For user-initiated requests, check session and nation admin status
      const session = await auth();

      if (!session) {
        console.log("Session not found");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (!isNationAdminFromSession(session)) {
        console.log("User is not a nation admin");
        return NextResponse.json(
          { error: "Forbidden - Nation admin access required" },
          { status: 403 },
        );
      }
    }

    // Revalidate the map page cache
    revalidatePath("/");

    console.log("revalidate", {
      source: isInternalRequest ? "internal" : "user",
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revalidating cache", { error });
    return NextResponse.json(
      { error: "Failed to revalidate cache" },
      { status: 500 },
    );
  }
}
