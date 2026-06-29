import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { auth } from "@acme/auth";
import { isNationAdminFromSession } from "@acme/shared/app/role-checks";
import { env } from "~/env";
import { logError, logInfo, logWarn } from "~/lib/logging";

// Regeneration of `/` fetches the slow map endpoints, so allow generous time
// but never hang the revalidation forever.
const WARM_TIMEOUT_MS = 30_000;

/**
 * Trigger ISR regeneration of `/` on this instance by requesting it over
 * localhost. Returns whether the warm-up GET completed successfully; all errors
 * (timeouts, network, non-2xx) are swallowed so they can't fail the caller.
 */
async function warmMapPage(): Promise<boolean> {
  const port = process.env.PORT ?? "3000";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WARM_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      // Bypass the fetch cache so this actually drives regeneration.
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok;
  } catch (warmError) {
    logWarn("map.revalidate.warm_failed", { warmError });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    // Check for internal API key authentication (from API app)
    const apiKey = request.headers.get("x-api-key");
    const isInternalRequest = apiKey === env.SUPER_ADMIN_API_KEY;

    if (!isInternalRequest) {
      logInfo("map.revalidate.session_check", {});

      // For user-initiated requests, check session and nation admin status
      const session = await auth();

      if (!session) {
        logWarn("map.revalidate.unauthorized", {});
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (!isNationAdminFromSession(session)) {
        logWarn("map.revalidate.forbidden", {});
        return NextResponse.json(
          { error: "Forbidden - Nation admin access required" },
          { status: 403 },
        );
      }
    }

    // Revalidate the map page cache
    revalidatePath("/");

    // Self-fetch localhost to eagerly ISR-regenerate on this instance; other
    // Cloud Run instances revalidate lazily on their next visitor.
    const warmed = await warmMapPage();

    logInfo("map.revalidate.success", {
      source: isInternalRequest ? "internal" : "user",
      warmed,
    });

    return NextResponse.json({ success: true, warmed });
  } catch (error) {
    logError("map.revalidate.error", {}, error);
    return NextResponse.json(
      { error: "Failed to revalidate cache" },
      { status: 500 },
    );
  }
}
