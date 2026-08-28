/**
 * Per-client admin operations — see the list/create route's file comment
 * for the overall design. `disabled` is handled as a direct DB update
 * rather than through adminUpdateOAuthClient: that endpoint's `update`
 * schema has no `disabled` field (confirmed against the installed type
 * definitions), and disabling a client is exactly the kind of thing that
 * should never be a hard delete — see docs/AI_GUARDRAILS.md's "Never
 * hard-delete... when a soft delete exists" rule. There is no hard-delete
 * route here at all, by design.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { betterAuthOauthClient } from "@acme/db/schema/schema";

import { db } from "~/lib/db";
import { getAuth } from "~/lib/better-auth";
import { logError } from "~/lib/logging";
import { requireSuperAdminApiKey } from "~/lib/require-super-admin";

interface UpdateOAuthClientBody {
  name?: string;
  redirectUris?: string[];
  scope?: string;
  disabled?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const unauthorized = requireSuperAdminApiKey(request);
  if (unauthorized) return unauthorized;

  const { clientId } = await params;
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof parsedBody !== "object" || parsedBody === null) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsedBody as UpdateOAuthClientBody;

  const [existing] = await db
    .select({ clientId: betterAuthOauthClient.clientId })
    .from(betterAuthOauthClient)
    .where(eq(betterAuthOauthClient.clientId, clientId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Field update (via Better Auth, can fail) runs before the disabled flip
  // (a direct DB write that can't fail the same way) — otherwise a request
  // that renames and disables a client in one call could commit the disable
  // and then 500 on the rename, leaving the client disabled despite the
  // caller seeing a failure.
  const hasFieldUpdate =
    body.name !== undefined ||
    body.redirectUris !== undefined ||
    body.scope !== undefined;

  if (hasFieldUpdate) {
    try {
      const auth = await getAuth();
      await auth.api.adminUpdateOAuthClient({
        body: {
          client_id: clientId,
          update: {
            ...(body.name !== undefined && { client_name: body.name }),
            ...(body.redirectUris !== undefined && {
              redirect_uris: body.redirectUris,
            }),
            ...(body.scope !== undefined && { scope: body.scope }),
          },
        },
      });
    } catch (err) {
      logError("auth.admin.oauth_client_update_failed", { clientId }, err);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  }

  // Enable/disable is a direct DB flip — see file comment. Applied even
  // when other fields are also present in the same request, so a caller
  // doesn't need two round-trips to rename a client and disable it at once.
  if (typeof body.disabled === "boolean") {
    try {
      await db
        .update(betterAuthOauthClient)
        .set({ disabled: body.disabled, updatedAt: new Date().toISOString() })
        .where(eq(betterAuthOauthClient.clientId, clientId));
    } catch (err) {
      logError("auth.admin.oauth_client_disable_failed", { clientId }, err);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  }

  return NextResponse.json({ updated: true });
}
