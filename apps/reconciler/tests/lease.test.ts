import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEARTBEAT_INTERVAL_MS,
  LEASE_KEY_DOMAIN_RECONCILER,
  LeaseLostError,
  StuckOperationError,
  acquireLease,
  heartbeatLease,
  releaseLease,
  withHeartbeat,
} from "../src/lease.js";
import type { HeartbeatTimers, Lease, LeaseSqlExecutor } from "../src/lease.js";
import type { Logger } from "../src/logging.js";

/**
 * The lease module's only surface to the database is a `postgres-js` Sql
 * tagged-template object. Tests mock it with a recorder that returns a
 * programmed value for each call, so we never touch a real Postgres.
 *
 * The tagged-template shape (`sql\`...\``) is modeled as a function that
 * accepts TemplateStringsArray + values and returns a Promise. `sql.begin`
 * is a function that calls its callback with a transaction object that
 * behaves the same way.
 */
interface RecordedCall {
  strings: readonly string[];
  values: readonly unknown[];
}

interface MockSql {
  executor: LeaseSqlExecutor;
  calls: RecordedCall[];
  nextResults: unknown[][];
}

function createMockSql(results: unknown[][]): MockSql {
  const calls: RecordedCall[] = [];
  const nextResults = [...results];

  function tagged(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> {
    calls.push({ strings: [...strings], values });
    const result = nextResults.shift();
    return Promise.resolve(result ?? []);
  }

  const executor = tagged as unknown as LeaseSqlExecutor;
  (executor as unknown as { begin: unknown }).begin = async (
    cb: (tx: LeaseSqlExecutor) => Promise<unknown>,
  ) => cb(executor);
  (executor as unknown as { unsafe: unknown }).unsafe = () => {
    throw new Error("unsafe() not used in lease module");
  };

  return { executor, calls, nextResults };
}

const SAMPLE_ROW = {
  lease_key: LEASE_KEY_DOMAIN_RECONCILER,
  held_by: "test-instance-1",
  acquired_at: "2026-04-14T10:00:00.000Z",
  expires_at: "2026-04-14T10:04:00.000Z",
};

describe("acquireLease", () => {
  it("returns the claimed lease when INSERT returns a row", async () => {
    // First call is DELETE (no rows), second call is INSERT with a row.
    const mock = createMockSql([[], [SAMPLE_ROW]]);
    const lease = await acquireLease(mock.executor, {
      instanceId: "test-instance-1",
    });
    expect(lease).not.toBeNull();
    expect(lease?.leaseKey).toBe(LEASE_KEY_DOMAIN_RECONCILER);
    expect(lease?.heldBy).toBe("test-instance-1");
    expect(lease?.acquiredAt).toBe("2026-04-14T10:00:00.000Z");
    expect(lease?.expiresAt).toBe("2026-04-14T10:04:00.000Z");
    expect(mock.calls).toHaveLength(2);
    // Basic sanity: the DELETE + INSERT SQL is present in the call record.
    expect(mock.calls[0]?.strings.join("")).toContain(
      "DELETE FROM reconciler_leases",
    );
    expect(mock.calls[1]?.strings.join("")).toContain(
      "INSERT INTO reconciler_leases",
    );
    expect(mock.calls[1]?.strings.join("")).toContain(
      "ON CONFLICT (lease_key) DO NOTHING",
    );
  });

  it("returns null when INSERT returns no rows (another instance holds lease)", async () => {
    const mock = createMockSql([[], []]);
    const lease = await acquireLease(mock.executor, {
      instanceId: "test-instance-2",
    });
    expect(lease).toBeNull();
  });
});

describe("heartbeatLease", () => {
  const lease: Lease = {
    leaseKey: LEASE_KEY_DOMAIN_RECONCILER,
    heldBy: "test-instance-1",
    acquiredAt: "2026-04-14T10:00:00.000Z",
    expiresAt: "2026-04-14T10:04:00.000Z",
  };

  it("returns the new expiry when UPDATE matches", async () => {
    const mock = createMockSql([[{ expires_at: "2026-04-14T10:04:30.000Z" }]]);
    const result = await heartbeatLease(mock.executor, lease);
    expect(result).not.toBeNull();
    expect(result?.newExpiresAt).toBe("2026-04-14T10:04:30.000Z");
    expect(mock.calls[0]?.strings.join("")).toContain(
      "UPDATE reconciler_leases",
    );
    expect(mock.calls[0]?.strings.join("")).toContain("expires_at > timezone");
  });

  it("returns null when the lease was stolen (UPDATE zero rows)", async () => {
    const mock = createMockSql([[]]);
    const result = await heartbeatLease(mock.executor, lease);
    expect(result).toBeNull();
  });
});

describe("releaseLease", () => {
  it("is idempotent — does not throw on zero affected rows", async () => {
    const mock = createMockSql([[]]);
    await expect(
      releaseLease(mock.executor, {
        leaseKey: LEASE_KEY_DOMAIN_RECONCILER,
        heldBy: "test-instance-1",
        acquiredAt: "2026-04-14T10:00:00.000Z",
        expiresAt: "2026-04-14T10:04:00.000Z",
      }),
    ).resolves.toBeUndefined();
    expect(mock.calls[0]?.strings.join("")).toContain(
      "DELETE FROM reconciler_leases",
    );
  });
});

// ---------------------------------------------------------------------------
// withHeartbeat — uses fake timers + injected heartbeatFn
// ---------------------------------------------------------------------------

interface FakeTimerController extends HeartbeatTimers {
  advance(ms: number): Promise<void>;
}

function createFakeTimers(start = 0): FakeTimerController {
  let current = start;
  let nextId = 1;
  const intervals: { id: number; cb: () => void; ms: number; last: number }[] =
    [];

  async function flush(): Promise<void> {
    // Allow queued microtasks (heartbeat promise chains) to settle so the
    // async effects of each tick are visible to the test.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }

  return {
    setInterval(cb, ms) {
      const id = nextId++;
      intervals.push({ id, cb, ms, last: current });
      return id as unknown as NodeJS.Timeout;
    },
    clearInterval(handle) {
      const idx = intervals.findIndex(
        (i) => i.id === (handle as unknown as number),
      );
      if (idx >= 0) intervals.splice(idx, 1);
    },
    now() {
      return current;
    },
    async advance(ms) {
      const target = current + ms;
      while (current < target) {
        // Find the earliest next firing.
        let next = target;
        for (const iv of intervals) {
          const fireAt = iv.last + iv.ms;
          if (fireAt < next) next = fireAt;
        }
        current = next;
        // Fire all intervals whose time has come.
        for (const iv of intervals) {
          if (iv.last + iv.ms <= current) {
            iv.last = current;
            iv.cb();
          }
        }
        await flush();
      }
    },
  };
}

describe("withHeartbeat", () => {
  const loggerError = vi.fn();
  const loggerStuckOperation = vi.fn();
  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
    critical: vi.fn(),
    drift: vi.fn(),
    stuckOperation: loggerStuckOperation,
    certRenewal: vi.fn(),
  };

  const lease: Lease = {
    leaseKey: LEASE_KEY_DOMAIN_RECONCILER,
    heldBy: "test-instance-1",
    acquiredAt: "2026-04-14T10:00:00.000Z",
    expiresAt: "2026-04-14T10:04:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs fn to completion when the heartbeat keeps succeeding", async () => {
    const mock = createMockSql([]);
    const timers = createFakeTimers();
    const heartbeatFn = vi.fn(() => Promise.resolve({ newExpiresAt: "later" }));

    const result = await withHeartbeat(
      {
        sql: mock.executor,
        lease,
        logger,
        heartbeatFn,
        timers,
        operationName: "test-op",
      },
      async () => {
        // Advance past 3 intervals to exercise the heartbeat timer.
        await timers.advance(HEARTBEAT_INTERVAL_MS * 3);
        return "ok";
      },
    );

    expect(result).toBe("ok");
    expect(heartbeatFn).toHaveBeenCalledTimes(3);
  });

  it("throws LeaseLostError when the heartbeat returns null", async () => {
    const mock = createMockSql([]);
    const timers = createFakeTimers();
    const heartbeatFn = vi.fn(() => Promise.resolve(null));

    await expect(
      withHeartbeat(
        {
          sql: mock.executor,
          lease,
          logger,
          heartbeatFn,
          timers,
          operationName: "test-op",
        },
        async (status) => {
          await timers.advance(HEARTBEAT_INTERVAL_MS);
          // Caller observes the lost status and returns; wrapper should
          // still throw LeaseLostError.
          expect(status.isLost()).toBe(true);
        },
      ),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(loggerError).toHaveBeenCalledWith(
      "reconciler lease lost during heartbeat",
      expect.objectContaining({ operation: "test-op" }),
    );
  });

  it("throws StuckOperationError after exceeding the hard cap", async () => {
    const mock = createMockSql([]);
    const timers = createFakeTimers();
    const heartbeatFn = vi.fn(() => Promise.resolve({ newExpiresAt: "later" }));

    await expect(
      withHeartbeat(
        {
          sql: mock.executor,
          lease,
          logger,
          heartbeatFn,
          timers,
          maxDurationMs: HEARTBEAT_INTERVAL_MS * 2,
          operationName: "test-op",
        },
        async () => {
          // Cross the cap: advance 3 intervals; the 3rd tick should log
          // stuckOperation and throw on return.
          await timers.advance(HEARTBEAT_INTERVAL_MS * 3);
        },
      ),
    ).rejects.toBeInstanceOf(StuckOperationError);
    expect(loggerStuckOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operationName: "test-op" }),
    );
  });
});
