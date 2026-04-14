/**
 * POST /api/bindings/:orgId/verify — F3R5_013, Decision 9.
 *
 * Body: { action: "confirm" | "report_mismatch" }
 *
 * - Requires an SSO session
 * - Requires admin/editor on the org (direct Supabase query)
 * - Rate-limited to 10 req/min/user via an in-memory token bucket
 * - Delegates all business logic to `verifyBinding` service
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { checkUserRoleOnOrg } from "@/lib/services/user-orgs";
import {
  publicVerifyBindingErrorBody,
  statusForVerifyBindingError,
  verifyBinding,
} from "@/lib/services/verify-binding";
import type {
  VerifyBindingAction,
  VerifyBindingDb,
  VerifyValidatorClient,
} from "@/lib/services/verify-binding";
import { getValidatorClient } from "@/lib/validator-factory";
import { tryConsumeVerifyBinding } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ orgId: string }>;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (!tryConsumeVerifyBinding(user.userId)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { orgId: orgIdRaw } = await ctx.params;
  const orgId = Number.parseInt(orgIdRaw, 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return NextResponse.json(
      { error: "invalid_org_id", detail: orgIdRaw },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = readAction(body);
  if (!action) {
    return NextResponse.json(
      { error: "invalid_action", allowed: ["confirm", "report_mismatch"] },
      { status: 400 },
    );
  }

  const { db: supabase } = getSupabaseDb();
  const authorized = await checkUserRoleOnOrg(supabase, {
    userId: user.userId,
    orgId,
  });
  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { db } = getRedirectAdminDb();
  const validator = getValidatorClient();

  const result = await verifyBinding(
    { orgId, userId: user.userId, action },
    {
      // Our real Drizzle db + ValidatorClient are structurally compatible
      // with the narrower surfaces the service declares.
      db: db as unknown as VerifyBindingDb,
      validator: validator as unknown as VerifyValidatorClient,
    },
  );

  if (!result.ok) {
    const status = statusForVerifyBindingError(result.error);
    return NextResponse.json(publicVerifyBindingErrorBody(result.error), {
      status,
    });
  }

  return NextResponse.json({ ok: true, redirect: "/?flash=verified" });
}

function readAction(body: unknown): VerifyBindingAction | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as { action?: unknown }).action;
  if (raw === "confirm" || raw === "report_mismatch") return raw;
  return null;
}
