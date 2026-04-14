/**
 * Operation 4 — Post-cutover DNS verification
 *
 * Trigger: rows where lifecycle_state = 'awaiting_cutover'.
 *
 * Flow (R5 Decision 6, op 4):
 *
 *   1. Resolve apex A/AAAA via public DNS (this op INTENTIONALLY uses
 *      public DNS — the point is to verify the user's DNS change took
 *      effect).
 *   2. Confirm A points to REDIRECT_LB_IPV4 (and AAAA to REDIRECT_LB_IPV6
 *      when set).
 *   3. Make an HTTPS request to `https://<hostname>/` through public DNS
 *      and confirm a 307 to the expected target:
 *        - apex → https://regions.f3nation.com/<region_slug>
 *        - stats → https://pax-vault.f3nation.com/stats/region/<region_id>
 *   4. On success, transition awaiting_cutover → active.
 *   5. On failure, stay in awaiting_cutover (user may not have updated DNS
 *      yet). Log at INFO level, bump last_reconciled_at.
 */

import { promises as dnsPromises } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";

import {
  appendDomainEvent,
  stateGuardedUpdate,
  touchReconciledAt,
} from "./shared.js";
import type { OperationContext } from "./shared.js";

const MAX_ROWS_PER_CYCLE = 20;
const HTTPS_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Config — same LB IPs as op 3, but used only for the `A`/`AAAA` equality
// check. This op is the only place in the reconciler where we talk to
// public DNS on the tenant hostname.
// ---------------------------------------------------------------------------

export interface PostCutoverConfig {
  lbIpv4: string;
  lbIpv6?: string;
  /** Injectable DNS resolver (test seam). */
  dnsResolver?: {
    resolve4(hostname: string): Promise<string[]>;
    resolve6(hostname: string): Promise<string[]>;
  };
  /** Injectable HTTPS head-requester (test seam). */
  httpsHead?: (input: {
    hostname: string;
    path: string;
  }) => Promise<{ status: number | null; location: string | null }>;
  now?: () => Date;
}

export class MissingPostCutoverLbIpError extends Error {
  constructor() {
    super(
      "REDIRECT_LB_IPV4 is not set; post-cutover DNS verification requires it.",
    );
    this.name = "MissingPostCutoverLbIpError";
  }
}

export function loadPostCutoverConfig(
  env: NodeJS.ProcessEnv = process.env,
): PostCutoverConfig {
  const lbIpv4 = env.REDIRECT_LB_IPV4;
  if (!lbIpv4) {
    throw new MissingPostCutoverLbIpError();
  }
  return {
    lbIpv4,
    ...(env.REDIRECT_LB_IPV6 ? { lbIpv6: env.REDIRECT_LB_IPV6 } : {}),
  };
}

// ---------------------------------------------------------------------------
// Expected redirect targets
// ---------------------------------------------------------------------------

export function expectedRedirectTarget(row: RegionCustomDomain): string {
  if (row.hostnameRole === "apex") {
    return `https://regions.f3nation.com/${row.regionSlug}`;
  }
  if (row.hostnameRole === "stats") {
    return `https://pax-vault.f3nation.com/stats/region/${row.regionId}`;
  }
  throw new Error(`unknown hostname_role: ${String(row.hostnameRole)}`);
}

// ---------------------------------------------------------------------------
// Default HTTPS head requester
// ---------------------------------------------------------------------------

function defaultHttpsHead(input: {
  hostname: string;
  path: string;
}): Promise<{ status: number | null; location: string | null }> {
  return new Promise((resolve) => {
    const options: RequestOptions = {
      hostname: input.hostname,
      port: 443,
      path: input.path,
      method: "GET",
      headers: {
        "User-Agent": "redirect-platform-reconciler/1.0",
      },
    };
    const req = httpsRequest(options, (res: IncomingMessage) => {
      const location = res.headers.location ?? null;
      const status = res.statusCode ?? null;
      // Drain and discard body; we only care about status + Location.
      res.resume();
      res.on("end", () => {
        resolve({ status, location });
      });
      res.on("error", () => {
        resolve({ status, location });
      });
    });
    req.setTimeout(HTTPS_TIMEOUT_MS, () => {
      req.destroy(new Error("HTTPS request timeout"));
    });
    req.on("error", () => {
      resolve({ status: null, location: null });
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// DNS verification helpers
// ---------------------------------------------------------------------------

export interface DnsVerifyResult {
  a_records: string[];
  aaaa_records: string[];
  a_matches: boolean;
  aaaa_matches: boolean;
  error: string | null;
}

export async function verifyDnsPointsAtLb(
  hostname: string,
  config: PostCutoverConfig,
): Promise<DnsVerifyResult> {
  const resolver = config.dnsResolver ?? {
    resolve4: (h) => dnsPromises.resolve4(h),
    resolve6: (h) => dnsPromises.resolve6(h),
  };
  let aRecords: string[] = [];
  let aaaaRecords: string[] = [];
  let error: string | null = null;
  try {
    aRecords = await resolver.resolve4(hostname);
  } catch (err) {
    error = `A-record lookup failed: ${String(err)}`;
  }
  if (config.lbIpv6) {
    try {
      aaaaRecords = await resolver.resolve6(hostname);
    } catch (err) {
      // AAAA lookup failure is non-fatal if we don't require IPv6 coverage.
      error = error ?? `AAAA-record lookup failed: ${String(err)}`;
    }
  }
  const aMatches = aRecords.includes(config.lbIpv4);
  const aaaaMatches = !config.lbIpv6 || aaaaRecords.includes(config.lbIpv6);
  return {
    a_records: aRecords,
    aaaa_records: aaaaRecords,
    a_matches: aMatches,
    aaaa_matches: aaaaMatches,
    error,
  };
}

// ---------------------------------------------------------------------------
// Operation entry point
// ---------------------------------------------------------------------------

export async function runPostCutoverVerification(
  ctx: OperationContext,
  config: PostCutoverConfig,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "awaiting_cutover"))
    .limit(MAX_ROWS_PER_CYCLE);
  const httpsHead = config.httpsHead ?? defaultHttpsHead;
  for (const row of rows) {
    await reconcileOnePostCutover(ctx, config, row, httpsHead);
  }
}

export async function reconcileOnePostCutover(
  ctx: OperationContext,
  config: PostCutoverConfig,
  row: RegionCustomDomain,
  httpsHead: NonNullable<PostCutoverConfig["httpsHead"]>,
): Promise<void> {
  const logFields = { domain_id: row.id, hostname: row.hostname };

  const dnsResult = await verifyDnsPointsAtLb(row.hostname, config);
  if (!dnsResult.a_matches || !dnsResult.aaaa_matches) {
    ctx.logger.info(
      "awaiting_cutover: DNS does not yet point at LB; staying in state",
      {
        ...logFields,
        a_records: dnsResult.a_records,
        aaaa_records: dnsResult.aaaa_records,
      },
    );
    await touchReconciledAt(ctx.db, row.id);
    return;
  }

  const expected = expectedRedirectTarget(row);
  const httpResult = await httpsHead({ hostname: row.hostname, path: "/" });
  if (httpResult.status !== 307 || httpResult.location !== expected) {
    ctx.logger.info(
      "awaiting_cutover: HTTP response does not match expected redirect",
      {
        ...logFields,
        http_status: httpResult.status,
        http_location: httpResult.location,
        expected_location: expected,
      },
    );
    await touchReconciledAt(ctx.db, row.id);
    return;
  }

  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "awaiting_cutover",
    newState: "active",
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on awaiting_cutover → active; another worker advanced",
      logFields,
    );
    return;
  }
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.post_cutover_verified",
    fromState: "awaiting_cutover",
    toState: "active",
    details: {
      dns_result: dnsResult,
      http_status: httpResult.status,
      http_location: httpResult.location,
    },
    reconcilerRunId: ctx.reconcilerRunId,
  });
  ctx.logger.info("advanced awaiting_cutover → active", logFields);
}
