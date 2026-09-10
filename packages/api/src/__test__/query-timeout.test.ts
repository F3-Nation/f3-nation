import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withQueryTimeout } from "@acme/db/testing";

// Coverage for the client-side query timeout. Lives here rather than
// packages/db because this package already has the live-Postgres vitest
// harness (TEST_DATABASE_URL + global setup). The wrapper's behavior
// depends on postgres-js internals — lazy dispatch on first await,
// out-of-band CancelRequest — so the core paths run the real wire
// protocol; the timer/canceller bookkeeping that needs no server runs
// against a minimal fake in the second block.
describe("withQueryTimeout (live Postgres)", () => {
  const connect = () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    // max: 1 makes cancellation observable: a second query can only be fast
    // if the first was genuinely cancelled and the sole connection freed.
    return postgres(url, { max: 1, prepare: false });
  };

  it("passes queries that finish within the timeout through untouched", async () => {
    const client = connect();
    try {
      withQueryTimeout(client, 5_000);
      const rows = await client.unsafe("select 1 as one");
      expect(rows).toMatchObject([{ one: 1 }]);
    } finally {
      await client.end();
    }
  });

  it(
    "rejects a query that exceeds the timeout instead of hanging",
    { timeout: 15_000 },
    async () => {
      const client = connect();
      try {
        withQueryTimeout(client, 500);
        const started = Date.now();
        await expect(client.unsafe("select pg_sleep(10)")).rejects.toThrow(
          /pool-wait\/execution timeout/,
        );
        // Rejected by the timer (~500ms), not by pg_sleep completing (10s).
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        await client.end();
      }
    },
  );

  it(
    "cancels the timed-out query so the connection is freed",
    { timeout: 15_000 },
    async () => {
      const client = connect();
      // Capture the unwrapped unsafe for the follow-up probe: the probe
      // must not race the 500ms timeout itself while it waits for the
      // cancellation to free the sole connection.
      const rawUnsafe = client.unsafe.bind(client);
      try {
        withQueryTimeout(client, 500);
        await expect(client.unsafe("select pg_sleep(10)")).rejects.toThrow();
        // With max: 1 there is a single connection. If the CancelRequest
        // did not actually kill pg_sleep(10) server-side, this probe would
        // queue behind it for the remaining ~9.5s and trip the bound below.
        const started = Date.now();
        const rows = await rawUnsafe("select 1 as one");
        expect(rows).toMatchObject([{ one: 1 }]);
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        await client.end();
      }
    },
  );

  it("leaves transactions functional (BEGIN is not wrapped)", async () => {
    const client = connect();
    try {
      withQueryTimeout(client, 500);
      // begin() routes its BEGIN through the wrapped unsafe() with an
      // onexecute option; the discriminator must hand it through untouched
      // or the reservation machinery breaks. The statements inside run on
      // the transaction-scoped client and commit normally.
      const result = await client.begin(async (tx) => {
        const rows = await tx.unsafe("select 41 + 1 as answer");
        return rows;
      });
      expect(result).toMatchObject([{ answer: 42 }]);
    } finally {
      await client.end();
    }
  });

  it(
    "rejects a query stuck waiting in the client-side pool queue",
    { timeout: 15_000 },
    async () => {
      const client = connect();
      const rawUnsafe = client.unsafe.bind(client);
      try {
        // Occupy the sole connection with an UNWRAPPED long query so the
        // wrapped query never gets a connection — the exact saturation
        // scenario this wrapper exists to bound.
        const blocker = rawUnsafe("select pg_sleep(10)");
        const blockerSettled = blocker.then(
          () => undefined,
          () => undefined,
        );
        withQueryTimeout(client, 500);
        const started = Date.now();
        await expect(client.unsafe("select 1 as one")).rejects.toThrow(
          /pool-wait\/execution timeout/,
        );
        expect(Date.now() - started).toBeLessThan(5_000);
        // Clean up: cancel the blocker so end() doesn't wait out the sleep.
        blocker.cancel();
        await blockerSettled;
      } finally {
        await client.end();
      }
    },
  );
});

describe("withQueryTimeout (timer/canceller bookkeeping, faked client)", () => {
  // A minimal stand-in for postgres.Sql exposing exactly what the wrapper
  // touches: unsafe() returning a lazy thenable with a canceller.
  const makeFake = (canceller?: (q: unknown) => Promise<unknown>) => {
    const query = {
      then: vi.fn(
        (
          _onFulfilled?: (v: unknown) => unknown,
          _onRejected?: (e: unknown) => unknown,
        ) => undefined,
      ),
      canceller: canceller ?? null,
    };
    const client = {
      unsafe: vi.fn(() => query),
    };
    return { client: client as unknown as postgres.Sql, query };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a query awaited more than once shares a single timer", () => {
    const { client } = makeFake();
    withQueryTimeout(client, 1_000);
    const wrapped = client.unsafe("select 1");
    void wrapped.then(
      () => undefined,
      () => undefined,
    );
    void wrapped.then(
      () => undefined,
      () => undefined,
    );
    // The bounded ??= memoization means the second .then() must not arm a
    // second timer racing the same query.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("skips wrapping when unsafe() is called with an onexecute option (transaction BEGIN)", () => {
    const { client, query } = makeFake();
    withQueryTimeout(client, 1_000);
    const beginQuery = client.unsafe("begin", [], {
      // Matches postgres-js's begin(): the only unsafe() caller passing
      // onexecute. The wrapper must return the raw query untouched.
      onexecute: () => undefined,
    } as never);
    expect(beginQuery).toBe(query);
    void (beginQuery as unknown as { then: unknown });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a failing canceller is handled — no unhandled rejection — and fires once", async () => {
    const cancelError = new Error("cancel connection refused");
    const canceller = vi.fn(() => Promise.reject(cancelError));
    const { client, query } = makeFake(canceller);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      withQueryTimeout(client, 1_000);
      const wrapped = client.unsafe("select pg_sleep(10)");
      const settled = (
        wrapped.then(
          () => undefined,
          (e: unknown) => e,
        )
      ).then((e) => e);
      vi.advanceTimersByTime(1_000);
      await expect(settled).resolves.toBeInstanceOf(Error);
      // cancel()'s fire-once semantics are preserved by nulling canceller.
      expect(canceller).toHaveBeenCalledTimes(1);
      expect((query as unknown as { canceller: unknown }).canceller).toBeNull();
      // Let the canceller's rejection propagate through the microtask queue
      // under real timers, then assert it was caught and surfaced.
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toHaveLength(0);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("cancelling a timed-out query failed"),
        cancelError,
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
      consoleError.mockRestore();
    }
  });
});
