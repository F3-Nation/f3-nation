import type postgres from "postgres";

/**
 * postgres-js has no option for how long a query may wait behind a
 * saturated connection pool -- `connect_timeout` only bounds opening a new
 * physical connection (see #905). This wraps `client.unsafe()`, the single
 * chokepoint every drizzle-orm postgres-js query goes through (verified
 * against drizzle-orm's postgres-js/session.js: `execute`, `all`, `query`,
 * and `queryObjects` all call `client.unsafe()`), so a query that hasn't
 * settled within `timeoutMs` rejects the caller instead of hanging the
 * request indefinitely.
 *
 * The timer starts the first time the query is awaited (not when `unsafe()`
 * returns) -- postgres-js's `Query` is lazy: nothing is dispatched until
 * `.then()`/`.handle()` runs, so starting earlier would burn timeout budget
 * before the query ever reaches the pool.
 *
 * `query.cancel()` (postgres-js's own API) is still called as a best effort
 * so the connection is eventually freed and the server stops working on the
 * query, but the caller's promise does NOT wait on it: verified against
 * postgres-js's connection.js, a query still pipelined behind an earlier one
 * on the *same* connection (`max_pipeline` defaults to 100) has its actual
 * CancelRequest deferred until that connection's `ReadyForQuery` -- i.e.
 * until the earlier query finishes -- so relying on `cancel()`'s own promise
 * to settle the caller would defeat the timeout entirely in that case. A
 * failed cancellation attempt (the out-of-band cancel connection itself
 * couldn't connect) is swallowed rather than left as an unhandled rejection;
 * not logged, since this low-level package has no existing `@acme/logger`
 * wiring and adding one departs from that package's one-per-service pattern
 * for a rare edge case.
 *
 * Known gap: only wraps the top-level client passed in. Queries run inside
 * `db.transaction()` execute against a separately-scoped client postgres-js
 * hands to the transaction callback, which isn't wrapped here.
 */
export function withQueryTimeout(client: postgres.Sql, timeoutMs: number) {
  const originalUnsafe = client.unsafe.bind(client);
  client.unsafe = ((...args: Parameters<typeof originalUnsafe>) => {
    const query = originalUnsafe(...args);
    const originalThen = query.then.bind(query);
    let bounded: Promise<unknown> | undefined;

    query.then = ((
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => {
      bounded ??= new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Query exceeded ${timeoutMs}ms pool-wait/execution timeout`,
            ),
          );
          (query.cancel() as Promise<unknown> | undefined)?.catch(() => {
            // Best-effort cancellation failed (e.g. the out-of-band cancel
            // connection couldn't connect); the caller has already been
            // rejected above, nothing else to settle.
          });
        }, timeoutMs);
        void originalThen(
          (value: unknown) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err: unknown) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          },
        );
      });
      return bounded.then(onFulfilled ?? undefined, onRejected ?? undefined);
    }) as typeof query.then;

    return query;
  }) as typeof client.unsafe;
}
