/**
 * POST /api/admins/drift-acknowledge — F3R5_013, Decision 6.
 *
 * Super-admin sign-off endpoint. Writes a `drift_acknowledged` event
 * row for a degraded domain. The retry-reconciliation endpoint reads
 * this event as the gate before permitting a state transition.
 *
 * Body: { domainId: string, justification: string }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import {
  driftAcknowledge,
  statusForDriftAcknowledgeError,
} from "@/lib/services/drift-acknowledge";
import type { DriftAcknowledgeDb } from "@/lib/services/drift-acknowledge";
import { isSuperAdmin } from "@/lib/services/super-admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isSuperAdmin(user.userId)) {
    return NextResponse.json(
      { error: "forbidden_super_admin" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const domainId = readString(body, "domainId");
  const justification = readString(body, "justification") ?? "";
  if (!domainId) {
    return NextResponse.json({ error: "invalid_domain_id" }, { status: 400 });
  }

  const { db } = getRedirectAdminDb();

  const result = await driftAcknowledge(
    { domainId, userId: user.userId, justification },
    { db: db as unknown as DriftAcknowledgeDb },
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.code },
      { status: statusForDriftAcknowledgeError(result.error) },
    );
  }
  return NextResponse.json({
    ok: true,
    acknowledged_at: result.value.acknowledgedAt,
  });
}

function readString(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}
