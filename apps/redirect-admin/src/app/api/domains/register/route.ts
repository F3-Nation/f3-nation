/**
 * POST /api/domains/register — thin wrapper over the registration
 * service (R5 Phase 1). The service itself holds all business logic so
 * it can be unit-tested without a real HTTP layer.
 *
 * Error handling:
 *   - Return structured `{ error, ... }` JSON
 *   - Never leak exception messages to the client — `internal_error`
 *     collapses to a generic response body.
 *   - Status codes come from `statusForRegisterError`.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { getRedirectAdminDb } from "@/lib/db-client";
import { getSessionUser } from "@/lib/auth/server";
import { getSupabaseDb } from "@/lib/supabase-client";
import { checkUserRoleOnOrg } from "@/lib/services/user-orgs";
import {
  publicErrorBody,
  registerDomain,
  statusForRegisterError,
} from "@/lib/services/domain-registration";
import type { RegisterDomainDeps } from "@/lib/services/domain-registration";
import {
  createDefaultCertManagerClient,
  getDefaultCertManagerClient,
} from "@/lib/cert-manager-client";

export const dynamic = "force-dynamic";

const RegisterSchema = z.object({
  org_id: z.number().int().positive(),
  hostname: z.string().min(1).max(253),
  hostname_role: z.enum(["apex", "stats"]),
});

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parseResult = RegisterSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "invalid_body", detail: parseResult.error.flatten() },
      { status: 400 },
    );
  }
  const { org_id, hostname, hostname_role } = parseResult.data;

  const { db: redirectAdminDb } = getRedirectAdminDb();
  const { db: supabase } = getSupabaseDb();

  // Prime the cert-manager client (dynamic import) before handing the
  // sync factory to the service. If this fails, we want to 500 early
  // with a clear error rather than crash mid-flow.
  try {
    await getDefaultCertManagerClient();
  } catch (err) {
    console.error("cert-manager init failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const deps: RegisterDomainDeps = {
    db: redirectAdminDb,
    certManagerFactory: createDefaultCertManagerClient,
    checkUserRole: (params) => checkUserRoleOnOrg(supabase, params),
  };

  const result = await registerDomain(
    {
      orgId: org_id,
      hostname,
      hostnameRole: hostname_role,
      userId: user.userId,
    },
    deps,
  );

  if (!result.ok) {
    return NextResponse.json(publicErrorBody(result.error), {
      status: statusForRegisterError(result.error),
    });
  }

  return NextResponse.json(
    {
      id: result.value.domain.id,
      hostname: result.value.domain.hostname,
      hostname_role: result.value.domain.hostnameRole,
      lifecycle_state: result.value.domain.lifecycleState,
      dns_challenge: {
        name: result.value.dnsChallenge.name,
        value: result.value.dnsChallenge.data,
        type: "CNAME",
      },
      reused_existing_authorization: result.value.reusedExistingAuthorization,
    },
    { status: 201 },
  );
}
