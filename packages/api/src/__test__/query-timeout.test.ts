import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { withQueryTimeout } from "@acme/db/testing";

// Integration coverage for the client-side query timeout (#905). Lives here
// rather than packages/db because this package already has the live-Postgres
// vitest harness (TEST_DATABASE_URL + global setup). The wrapper's behavior
// depends on postgres-js internals — lazy dispatch on first await,
// out-of-band CancelRequest — so mocked unit tests cannot meaningfully pin
// it; these tests run the real wire protocol.
describe("withQueryTimeout", () => {
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
      try {
        withQueryTimeout(client, 500);
        await expect(client.unsafe("select pg_sleep(10)")).rejects.toThrow();
        // With max: 1 there is a single connection. If the CancelRequest did
        // not actually kill pg_sleep(10) server-side, this follow-up query
        // would queue behind it for the remaining ~9.5s and trip the bound
        // below. 5s leaves generous margin for a slow CI runner while staying
        // far below the sleep duration.
        const started = Date.now();
        const rows = await client.unsafe("select 1 as one");
        expect(rows).toMatchObject([{ one: 1 }]);
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        await client.end();
      }
    },
  );
});
