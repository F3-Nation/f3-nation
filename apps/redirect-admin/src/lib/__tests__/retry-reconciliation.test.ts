import { describe, expect, it, vi } from "vitest";

import {
  retryReconciliation,
  statusForRetryReconciliationError,
} from "../services/retry-reconciliation";
import type { RetryReconciliationDb } from "../services/retry-reconciliation";

interface FakeDbConfig {
  domainRows?: unknown[];
  ackRows?: unknown[];
  updateReturning?: unknown[];
  updateThrows?: Error;
}

function fakeDb(cfg: FakeDbConfig = {}): RetryReconciliationDb & {
  _updateCalls: unknown[];
  _insertedEvents: unknown[];
} {
  const domainRows = cfg.domainRows ?? [];
  const ackRows = cfg.ackRows ?? [];
  const updateReturning = cfg.updateReturning ?? [];
  const updateCalls: unknown[] = [];
  const insertedEvents: unknown[] = [];
  let selectCall = 0;

  // First select() → domain row lookup; second select() → ack event
  // lookup (the service chains .orderBy().limit() on the second one).
  return {
    select: vi.fn(() => {
      const currentCall = selectCall;
      selectCall += 1;
      return {
        from: vi.fn(() => ({
          where: vi.fn((): unknown => {
            if (currentCall === 0) {
              // first select — plain where → Promise
              return Promise.resolve(domainRows);
            }
            // second select — chained .orderBy().limit(1)
            return {
              orderBy: vi.fn(() => ({
                limit: vi.fn(async () => ackRows),
              })),
              then: (resolve: (v: unknown[]) => unknown) => resolve(ackRows),
            };
          }),
        })),
      };
    }) as RetryReconciliationDb["select"],
    update: vi.fn(() => ({
      set: vi.fn((vals) => {
        updateCalls.push(vals);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (cfg.updateThrows) throw cfg.updateThrows;
              return updateReturning;
            }),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (row) => {
        insertedEvents.push(row);
      }),
    })),
    _updateCalls: updateCalls,
    _insertedEvents: insertedEvents,
  };
}

const degradedDomain = {
  id: "00000000-0000-0000-0000-000000000001",
  orgId: 42,
  lifecycleState: "degraded",
  reconcilerError: {
    drift_kind: "spec_mismatch",
    recoverable_from: "awaiting_dns_challenge",
    reconciler_run_id: "run-1",
  },
};

describe("retryReconciliation", () => {
  it("transitions degraded → target when ack exists", async () => {
    const db = fakeDb({
      domainRows: [degradedDomain],
      ackRows: [{ id: "ack-1" }],
      updateReturning: [
        { ...degradedDomain, lifecycleState: "awaiting_dns_challenge" },
      ],
    });
    const result = await retryReconciliation(
      { domainId: degradedDomain.id, userId: 99 },
      { db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetState).toBe("awaiting_dns_challenge");
    }
    expect(db._updateCalls).toHaveLength(1);
    const payload = db._updateCalls[0] as Record<string, unknown>;
    expect(payload.lifecycleState).toBe("awaiting_dns_challenge");
    expect(payload.reconcilerError).toBeNull();
    expect(db._insertedEvents).toHaveLength(1);
    const ev = db._insertedEvents[0] as Record<string, unknown>;
    expect(ev.eventType).toBe("manual_retry_reconciliation");
    expect(ev.actorUserId).toBe(99);
  });

  it("rejects when no drift acknowledgment exists", async () => {
    const db = fakeDb({
      domainRows: [degradedDomain],
      ackRows: [],
    });
    const result = await retryReconciliation(
      { domainId: degradedDomain.id, userId: 99 },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("drift_not_acknowledged");
    expect(db._updateCalls).toHaveLength(0);
  });

  it("rejects when domain not found", async () => {
    const db = fakeDb({ domainRows: [] });
    const result = await retryReconciliation(
      { domainId: "missing", userId: 99 },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("domain_not_found");
  });

  it("rejects when domain is not degraded", async () => {
    const db = fakeDb({
      domainRows: [{ ...degradedDomain, lifecycleState: "active" }],
    });
    const result = await retryReconciliation(
      { domainId: degradedDomain.id, userId: 99 },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "domain_not_degraded") {
      expect(result.error.actualState).toBe("active");
    } else {
      expect.fail("expected domain_not_degraded");
    }
  });

  it("rejects when recoverable_from is missing", async () => {
    const db = fakeDb({
      domainRows: [
        {
          ...degradedDomain,
          reconcilerError: { drift_kind: "unknown" },
        },
      ],
      ackRows: [{ id: "ack-1" }],
    });
    const result = await retryReconciliation(
      { domainId: degradedDomain.id, userId: 99 },
      { db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_recoverable_target");
  });

  it("normalizes recoverable_from='active' into awaiting_probe", async () => {
    const db = fakeDb({
      domainRows: [
        {
          ...degradedDomain,
          reconcilerError: {
            drift_kind: "spec_mismatch",
            recoverable_from: "active",
          },
        },
      ],
      ackRows: [{ id: "ack-1" }],
      updateReturning: [
        { ...degradedDomain, lifecycleState: "awaiting_probe" },
      ],
    });
    const result = await retryReconciliation(
      { domainId: degradedDomain.id, userId: 99 },
      { db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetState).toBe("awaiting_probe");
  });

  it("maps errors to HTTP status", () => {
    expect(
      statusForRetryReconciliationError({ code: "domain_not_found" }),
    ).toBe(404);
    expect(
      statusForRetryReconciliationError({
        code: "domain_not_degraded",
        actualState: "active",
      }),
    ).toBe(409);
    expect(
      statusForRetryReconciliationError({ code: "no_recoverable_target" }),
    ).toBe(422);
    expect(
      statusForRetryReconciliationError({ code: "drift_not_acknowledged" }),
    ).toBe(412);
    expect(
      statusForRetryReconciliationError({
        code: "internal_error",
        message: "x",
      }),
    ).toBe(500);
  });
});
