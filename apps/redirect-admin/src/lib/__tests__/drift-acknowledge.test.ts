import { describe, expect, it, vi } from "vitest";

import {
  driftAcknowledge,
  statusForDriftAcknowledgeError,
} from "../services/drift-acknowledge";
import type { DriftAcknowledgeDb } from "../services/drift-acknowledge";
import {
  isSuperAdmin,
  parseSuperAdminAllowlist,
} from "../services/super-admin";

interface FakeDbConfig {
  domainRows?: unknown[];
  insertThrows?: Error;
}

function fakeDb(cfg: FakeDbConfig = {}): DriftAcknowledgeDb & {
  _insertedEvents: unknown[];
} {
  const insertedEvents: unknown[] = [];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => cfg.domainRows ?? []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (row) => {
        if (cfg.insertThrows) throw cfg.insertThrows;
        insertedEvents.push(row);
      }),
    })),
    _insertedEvents: insertedEvents,
  };
}

const degradedDomain = {
  id: "00000000-0000-0000-0000-000000000001",
  orgId: 42,
  lifecycleState: "degraded",
};

describe("driftAcknowledge", () => {
  it("writes an event row with justification on happy path", async () => {
    const db = fakeDb({ domainRows: [degradedDomain] });
    const result = await driftAcknowledge(
      {
        domainId: degradedDomain.id,
        userId: 99,
        justification: "investigated orphan DNS auth record; safe to retry",
      },
      { db },
    );
    expect(result.ok).toBe(true);
    expect(db._insertedEvents).toHaveLength(1);
    const ev = db._insertedEvents[0] as Record<string, unknown>;
    expect(ev.eventType).toBe("drift_acknowledged");
    expect(ev.actorUserId).toBe(99);
    const details = ev.details as Record<string, unknown>;
    expect(details.action).toBe("drift_acknowledged");
    expect(details.justification).toContain("investigated");
  });

  it("rejects short justification", async () => {
    const db = fakeDb({ domainRows: [degradedDomain] });
    const result = await driftAcknowledge(
      { domainId: degradedDomain.id, userId: 99, justification: "hi" },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("justification_required");
    expect(db._insertedEvents).toHaveLength(0);
  });

  it("rejects missing domain", async () => {
    const db = fakeDb({ domainRows: [] });
    const result = await driftAcknowledge(
      {
        domainId: "missing",
        userId: 99,
        justification: "looked into the drift payload carefully",
      },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("domain_not_found");
  });

  it("rejects non-degraded domain", async () => {
    const db = fakeDb({
      domainRows: [{ ...degradedDomain, lifecycleState: "active" }],
    });
    const result = await driftAcknowledge(
      {
        domainId: degradedDomain.id,
        userId: 99,
        justification: "investigated thoroughly and found no issue",
      },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "domain_not_degraded") {
      expect(result.error.actualState).toBe("active");
    } else {
      expect.fail("expected domain_not_degraded");
    }
  });

  it("maps errors to HTTP status", () => {
    expect(
      statusForDriftAcknowledgeError({ code: "justification_required" }),
    ).toBe(400);
    expect(statusForDriftAcknowledgeError({ code: "domain_not_found" })).toBe(
      404,
    );
    expect(
      statusForDriftAcknowledgeError({
        code: "domain_not_degraded",
        actualState: "active",
      }),
    ).toBe(409);
    expect(
      statusForDriftAcknowledgeError({
        code: "internal_error",
        message: "x",
      }),
    ).toBe(500);
  });
});

describe("super-admin allowlist", () => {
  it("parses comma-separated list", () => {
    expect(parseSuperAdminAllowlist("1,42,128")).toEqual([1, 42, 128]);
  });

  it("ignores blanks and non-numerics", () => {
    expect(parseSuperAdminAllowlist(" 1, ,foo,42 ")).toEqual([1, 42]);
  });

  it("returns empty for undefined", () => {
    expect(parseSuperAdminAllowlist(undefined)).toEqual([]);
  });

  it("isSuperAdmin reads from injected source", () => {
    // Use a freshly-constructed process-env-shaped object. Using `unknown`
    // as the intermediate type avoids the `as NodeJS.ProcessEnv` shortcut
    // while still compiling under strict TS.
    const src: NodeJS.ProcessEnv = Object.assign({}, process.env, {
      REDIRECT_ADMIN_SUPER_ADMIN_USER_IDS: "7,99",
    });
    expect(isSuperAdmin(7, src)).toBe(true);
    expect(isSuperAdmin(99, src)).toBe(true);
    expect(isSuperAdmin(5, src)).toBe(false);
  });

  it("isSuperAdmin returns false when env var absent", () => {
    const src: NodeJS.ProcessEnv = Object.assign({}, process.env);
    delete src.REDIRECT_ADMIN_SUPER_ADMIN_USER_IDS;
    expect(isSuperAdmin(7, src)).toBe(false);
  });
});
