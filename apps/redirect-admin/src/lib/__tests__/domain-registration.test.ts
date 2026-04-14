/**
 * Unit tests for the pure domain-registration service. Route-handler
 * tests are intentionally omitted because the handler is a 30-line
 * wrapper — all branches are exercised through the service directly.
 */

import { describe, it, expect, vi } from "vitest";

import {
  publicErrorBody,
  registerDomain,
  statusForRegisterError,
} from "../services/domain-registration";
import type { RegisterDomainDeps } from "../services/domain-registration";
import type {
  CertManagerClientFactory,
  CertManagerLike,
} from "../cert-manager-client";

// ---------------------------------------------------------------------------
// Fake DB — models the small surface `domain-registration` uses.
// ---------------------------------------------------------------------------

interface FakeDbConfig {
  blocklistRows?: { hostname: string; reason: string }[];
  bindingRows?: {
    orgId: number;
    regionSlug: string;
    paxVaultRegionId: string;
    regionName: string;
    verificationState: "verified" | "unverified" | "revoked";
  }[];
  quotaRows?: { value: number }[];
  countRows?: { value: number }[];
  insertFailure?: Error;
  insertReturning?: unknown[];
  updateReturning?: unknown[];
}

function fakeDb(cfg: FakeDbConfig = {}) {
  const blocklistRows = cfg.blocklistRows ?? [];
  const bindingRows = cfg.bindingRows ?? [];
  const quotaRows = cfg.quotaRows ?? [];
  const countRows = cfg.countRows ?? [{ value: 0 }];
  const insertReturning = cfg.insertReturning ?? [
    {
      id: "row-uuid",
      orgId: bindingRows[0]?.orgId ?? 0,
      hostname: "placeholder",
      hostnameRole: "apex",
      lifecycleState: "pending",
    },
  ];
  const updateReturning = cfg.updateReturning ?? [
    {
      ...(insertReturning[0] as Record<string, unknown>),
      lifecycleState: "awaiting_dns_challenge",
      gcpDnsAuthorizationId:
        "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-row-uuid",
      dnsChallengeRecordName: "_acme-challenge.host.",
      dnsChallengeRecordValue: "target.gcp.",
    },
  ];

  // Sequence of select() responses. Order matches the service flow:
  // 1) blocklist, 2) quota max, 3) quota count, 4) binding lookup.
  const selectResults: unknown[][] = [
    blocklistRows,
    quotaRows,
    countRows,
    bindingRows,
  ];
  let selectCall = 0;

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          const r = selectResults[selectCall] ?? [];
          selectCall += 1;
          return r;
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          if (cfg.insertFailure) throw cfg.insertFailure;
          return insertReturning;
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateReturning),
        })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Fake cert-manager factory
// ---------------------------------------------------------------------------

function fakeCertFactory(): CertManagerClientFactory {
  const client: CertManagerLike = {
    createDnsAuthorization: vi.fn().mockResolvedValue([
      {
        promise: vi.fn().mockResolvedValue([
          {
            name: "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-row-uuid",
            dnsResourceRecord: {
              name: "_acme-challenge.host.",
              type: "CNAME",
              data: "target.gcp.",
            },
          },
        ]),
      },
    ]),
    getDnsAuthorization: vi.fn(),
  };
  return () => client;
}

function buildDeps(overrides: Partial<RegisterDomainDeps> = {}, db = fakeDb()) {
  return {
    db: db as unknown as RegisterDomainDeps["db"],
    certManagerFactory: overrides.certManagerFactory ?? fakeCertFactory(),
    checkUserRole: overrides.checkUserRole ?? vi.fn().mockResolvedValue(true),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerDomain", () => {
  const baseInput = {
    orgId: 42,
    hostname: "f3muletown.com",
    hostnameRole: "apex" as const,
    userId: 99,
  };

  const verifiedBinding = {
    orgId: 42,
    regionSlug: "muletown",
    paxVaultRegionId: "pv-muletown",
    regionName: "F3 Muletown",
    verificationState: "verified" as const,
  };

  it("happy path — registers, creates auth, returns DNS challenge", async () => {
    const db = fakeDb({
      bindingRows: [verifiedBinding],
      quotaRows: [{ value: 10 }],
      countRows: [{ value: 2 }],
    });
    const deps = buildDeps({}, db);
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dnsChallenge.type).toBe("CNAME");
      expect(result.value.dnsChallenge.name).toBe("_acme-challenge.host.");
      expect(result.value.dnsChallenge.data).toBe("target.gcp.");
    }
  });

  it("rejects invalid hostname before touching DB", async () => {
    const db = fakeDb();
    const deps = buildDeps({}, db);
    const result = await registerDomain(
      { ...baseInput, hostname: "not a hostname" },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("hostname_invalid");
    }
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects when role check fails", async () => {
    const db = fakeDb({ bindingRows: [verifiedBinding] });
    const deps = buildDeps(
      { checkUserRole: vi.fn().mockResolvedValue(false) },
      db,
    );
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("user_not_authorized");
    }
  });

  it("rejects blocked hostname with reason", async () => {
    const db = fakeDb({
      blocklistRows: [{ hostname: "f3muletown.com", reason: "reserved" }],
      bindingRows: [verifiedBinding],
    });
    const deps = buildDeps({}, db);
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "hostname_blocked") {
      expect(result.error.reason).toBe("reserved");
    } else {
      expect.fail("expected hostname_blocked");
    }
  });

  it("rejects when quota exceeded", async () => {
    const db = fakeDb({
      bindingRows: [verifiedBinding],
      quotaRows: [{ value: 5 }],
      countRows: [{ value: 5 }],
    });
    const deps = buildDeps({}, db);
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "quota_exceeded") {
      expect(result.error.quota.current).toBe(5);
      expect(result.error.quota.max).toBe(5);
    } else {
      expect.fail("expected quota_exceeded");
    }
  });

  it("rejects when org has no binding", async () => {
    const db = fakeDb({ bindingRows: [] });
    const deps = buildDeps({}, db);
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("binding_missing");
    }
  });

  it("rejects when binding is unverified", async () => {
    const db = fakeDb({
      bindingRows: [{ ...verifiedBinding, verificationState: "unverified" }],
    });
    const deps = buildDeps({}, db);
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "binding_unverified") {
      expect(result.error.verificationState).toBe("unverified");
    } else {
      expect.fail("expected binding_unverified");
    }
  });

  it("maps Postgres check_violation (trigger) to internal_error with message", async () => {
    const triggerError = Object.assign(new Error("trigger blocked"), {
      code: "23514",
    });
    const db = fakeDb({
      bindingRows: [verifiedBinding],
      quotaRows: [{ value: 10 }],
      countRows: [{ value: 0 }],
      insertFailure: triggerError,
    });
    const deps = buildDeps({}, db);
    const result = await registerDomain(baseInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "internal_error") {
      expect(result.error.message).toContain("23514");
    } else {
      expect.fail("expected internal_error");
    }
  });
});

describe("publicErrorBody + statusForRegisterError", () => {
  it("maps codes to HTTP status", () => {
    expect(
      statusForRegisterError({ code: "hostname_invalid", detail: "empty" }),
    ).toBe(400);
    expect(
      statusForRegisterError({
        code: "hostname_blocked",
        reason: "reserved",
      }),
    ).toBe(409);
    expect(statusForRegisterError({ code: "user_not_authorized" })).toBe(403);
    expect(statusForRegisterError({ code: "binding_missing" })).toBe(412);
    expect(
      statusForRegisterError({
        code: "binding_unverified",
        verificationState: "unverified",
      }),
    ).toBe(412);
    expect(
      statusForRegisterError({
        code: "quota_exceeded",
        quota: { allowed: false, current: 5, max: 5, source: "explicit" },
      }),
    ).toBe(429);
    expect(
      statusForRegisterError({ code: "internal_error", message: "boom" }),
    ).toBe(500);
  });

  it("scrubs internal_error message in public body", () => {
    const body = publicErrorBody({
      code: "internal_error",
      message: "secret details here",
    });
    expect(body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("leaks nothing for quota_exceeded beyond current/max", () => {
    const body = publicErrorBody({
      code: "quota_exceeded",
      quota: { allowed: false, current: 5, max: 5, source: "explicit" },
    });
    expect(body).toEqual({
      error: "quota_exceeded",
      quota: { current: 5, max: 5 },
    });
  });
});
