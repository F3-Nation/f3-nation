import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { and, eq, gt, isNull, or, schema, sql } from "@acme/db";
import { isNationAdminFromSession } from "@acme/shared/app/role-checks";

import { db } from "~/lib/db";

// Anchored to the DB clock, same as packages/api/src/shared.ts's DB_NOW —
// avoids app-server clock skew when checking expiresAt.
const DB_NOW = sql`timezone('utc'::text, now())`;

/**
 * Gate for the /api/admin/oauth-clients/* routes (#876 Phase 3 admin UI).
 * Verifies a real, revocable database-backed API key (created via
 * apps/admin's API Keys page, the same api_keys/roles_x_api_keys_x_org
 * tables every other API key in this system uses) instead of comparing
 * against a shared env-var secret — deliberately not SUPER_ADMIN_API_KEY,
 * see packages/api/src/router/oauth-client.ts's file comment for why.
 *
 * The key must carry the nation-admin role at the F3 Nation org, checked
 * with the same isNationAdminFromSession helper packages/api's own
 * nationAdminProcedure uses. No session check beyond that — these routes
 * are meant to be called server-to-server by apps/admin's own oRPC
 * backend, never directly from a browser.
 */
export async function requireNationAdminApiKey(
  request: NextRequest,
): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bearerToken = authHeader.slice(7).trim();
  if (!bearerToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [apiKeyRecord] = await db
    .select({ apiKeyId: schema.apiKeys.id })
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.key, bearerToken),
        isNull(schema.apiKeys.revokedAt),
        or(
          isNull(schema.apiKeys.expiresAt),
          gt(schema.apiKeys.expiresAt, DB_NOW),
        ),
      ),
    );
  if (!apiKeyRecord) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Recorded as soon as the key itself is confirmed valid — matches what
  // "used" means for the key as a credential, independent of whether the
  // role check below then rejects this specific request.
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: DB_NOW })
    .where(eq(schema.apiKeys.id, apiKeyRecord.apiKeyId));

  const orgRoles = await db
    .select({
      orgId: schema.orgs.id,
      orgName: schema.orgs.name,
      roleName: schema.roles.name,
    })
    .from(schema.rolesXApiKeysXOrg)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXApiKeysXOrg.orgId))
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.rolesXApiKeysXOrg.roleId),
    )
    .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, apiKeyRecord.apiKeyId));

  if (!isNationAdminFromSession({ roles: orgRoles })) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
