import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "~/env";

/**
 * Gate for the /api/admin/oauth-clients/* routes (#876 Phase 3 admin UI).
 * Mirrors packages/api/src/shared.ts's revalidateAuthProcedure: a plain
 * x-api-key header compared against SUPER_ADMIN_API_KEY. No session check —
 * these routes are meant to be called server-to-server by apps/admin's own
 * oRPC backend, never directly from a browser.
 */
export function requireSuperAdminApiKey(
  request: NextRequest,
): NextResponse | null {
  const apiKey = request.headers.get("x-api-key") ?? "";
  if (env.SUPER_ADMIN_API_KEY && apiKey === env.SUPER_ADMIN_API_KEY) {
    return null;
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
