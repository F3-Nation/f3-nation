/**
 * Internal region-binding validator endpoint (R5 Decision 11).
 *
 * GET /api/internal/region-binding/validate
 *   ?org_id=<int>&pax_vault_region_id=<string>&region_slug=<string>&calling_user_id=<int>
 *
 * Triangulates three sources (Supabase orgs/users via @acme/db, pax-vault
 * internal API, f3-region-pages) and returns a snapshot-ready validator
 * response. Called by apps/redirect-admin when creating or re-verifying a
 * row in `org_region_bindings` on Neon.
 *
 * This route sits ALONGSIDE the oRPC catch-all at `app/[[...rest]]/route.ts`.
 * Next.js App Router resolves static segments before catch-all segments, so
 * this file handles the path without touching the oRPC router.
 */

import { db } from "@acme/db/client";

import { regionBindingRateLimiter } from "../../../../../lib/region-binding-rate-limiter";
import { verifyRegionBindingS2sToken } from "../../../../../lib/region-binding-s2s-auth";
import { runRegionBindingValidator } from "../../../../../lib/region-binding-validator-service";

// Route is dynamic — it reads query params per request.
export const dynamic = "force-dynamic";

interface ParsedQuery {
  orgId: number;
  paxVaultRegionId: string;
  regionSlug: string;
  callingUserId: number;
}

interface ParseError {
  error: "invalid_query";
  detail: string;
}

const parseQuery = (
  url: URL,
): { ok: true; value: ParsedQuery } | { ok: false; error: ParseError } => {
  const orgIdRaw = url.searchParams.get("org_id");
  const paxVaultRegionId = url.searchParams.get("pax_vault_region_id");
  const regionSlug = url.searchParams.get("region_slug");
  const callingUserIdRaw = url.searchParams.get("calling_user_id");

  if (!orgIdRaw) {
    return {
      ok: false,
      error: { error: "invalid_query", detail: "org_id is required" },
    };
  }
  if (!paxVaultRegionId) {
    return {
      ok: false,
      error: {
        error: "invalid_query",
        detail: "pax_vault_region_id is required",
      },
    };
  }
  if (!regionSlug) {
    return {
      ok: false,
      error: { error: "invalid_query", detail: "region_slug is required" },
    };
  }
  if (!callingUserIdRaw) {
    return {
      ok: false,
      error: {
        error: "invalid_query",
        detail: "calling_user_id is required",
      },
    };
  }

  const orgId = Number(orgIdRaw);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return {
      ok: false,
      error: {
        error: "invalid_query",
        detail: "org_id must be a positive integer",
      },
    };
  }

  const callingUserId = Number(callingUserIdRaw);
  if (!Number.isInteger(callingUserId) || callingUserId <= 0) {
    return {
      ok: false,
      error: {
        error: "invalid_query",
        detail: "calling_user_id must be a positive integer",
      },
    };
  }

  return {
    ok: true,
    value: { orgId, paxVaultRegionId, regionSlug, callingUserId },
  };
};

const jsonResponse = (
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });

export const GET = async (request: Request): Promise<Response> => {
  // --- 1. s2s token ---
  const authResult = verifyRegionBindingS2sToken({
    authorizationHeader: request.headers.get("authorization"),
  });
  if (!authResult.ok) {
    return jsonResponse(401, { error: "invalid_s2s_token" });
  }

  // --- 2. parse and validate query ---
  const url = new URL(request.url);
  const parsed = parseQuery(url);
  if (!parsed.ok) {
    return jsonResponse(400, parsed.error);
  }

  // --- 3. per-caller rate limit (60 rpm) ---
  const rl = regionBindingRateLimiter.check(parsed.value.callingUserId);
  if (!rl.allowed) {
    return jsonResponse(
      429,
      { error: "rate_limited" },
      { "retry-after": String(rl.retryAfterSeconds) },
    );
  }

  // --- 4. run the validator ---
  const outcome = await runRegionBindingValidator(parsed.value, { db });

  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, outcome.body);
    case "org_not_found":
      return jsonResponse(404, { error: "org_not_found" });
    case "forbidden":
      return jsonResponse(403, { error: outcome.reason });
    case "mismatch":
      return jsonResponse(422, {
        error: "triple_mismatch",
        detail: outcome.detail,
      });
    case "source_unavailable":
      return jsonResponse(503, {
        error: "source_unavailable",
        source: outcome.source,
      });
  }
};
