import type postgres from "postgres";

/**
 * postgres-js has no option for how long a query may wait behind a
 * saturated connection pool -- `connect_timeout` only bounds opening a new
 * physical connection. This wraps `client.unsafe()`, the single chokepoint
 * every drizzle-orm postgres-js query goes through (verified against
 * drizzle-orm's postgres-js/session.js: `execute`, `all`, `query`, and
 * `queryObjects` all call `client.unsafe()`), so a query that hasn't
 * settled within `timeoutMs` rejects the caller instead of hanging the
 * request indefinitely.
 *
 * The timer starts the first time the query is awaited (not when `unsafe()`
 * returns) -- postgres-js's `Query` is lazy: nothing is dispatched until
 * `.then()`/`.handle()` runs, so starting earlier would burn timeout budget
 * before the query ever reaches the pool.
 *
 * Transaction entrypoints are deliberately NOT wrapped: postgres-js's own
 * `begin()` issues its BEGIN through this same `unsafe()` chokepoint
 * (index.js: `sql.unsafe('begin ...', [], { onexecute })`), and `onexecute`
 * reserves the connection the moment BEGIN is dispatched -- before any
 * response arrives. `begin()` has no unwind path for a rejected BEGIN, so
 * timing it out would strand the reservation with no COMMIT/ROLLBACK ever
 * issued, pinning the connection until max_lifetime tears the socket down
 * -- self-amplifying the very pool exhaustion this wrapper exists to bound.
 * `begin()` is the only unsafe() caller that passes `onexecute`, which
 * makes it a precise discriminator. Statements inside `db.transaction()`
 * (issued via the transaction-scoped client `begin()` hands its callback)
 * are likewise not wrapped here; both are bounded server-side instead by
 * the role-level statement_timeout on the app database users, which
 * applies at backend start regardless of PgBouncer's transaction pooling.
 * (The server-side bound cannot be set from this client: postgres-js sends
 * `connection` options as startup parameters, which PgBouncer rejects
 * unless ignored -- its ignore_startup_parameters only lists
 * extra_float_digits -- and per-session SET does not survive transaction
 * pooling.)
 *
 * On timeout the query is cancelled best-effort, via the pool's canceller
 * directly rather than `query.cancel()`: `cancel()` returns its
 * `this.canceller = null` comma-expression assignment (query.js) -- i.e.
 * `null` -- and discards the pool's actual cancellation promise, whose
 * rejection (the out-of-band CancelRequest connection failing, most likely
 * under the very saturation that caused the timeout) would then be an
 * unhandled rejection. The caller's promise does NOT wait on cancellation:
 * a query pipelined behind an earlier one on the same connection
 * (`max_pipeline` defaults to 100) has its CancelRequest deferred until
 * that connection's ReadyForQuery, so awaiting it would defeat the timeout.
 */
export function withQueryTimeout(client: postgres.Sql, timeoutMs: number) {
  const originalUnsafe = client.unsafe.bind(client);
  client.unsafe = ((...args: Parameters<typeof originalUnsafe>) => {
    // Transaction BEGIN -- see the docstring. `begin()` is the only caller
    // that passes an `onexecute` option through unsafe().
    const queryOptions = args[2] as { onexecute?: unknown } | undefined;
    if (typeof queryOptions?.onexecute === "function") {
      return originalUnsafe(...args);
    }

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
          // Best-effort cancellation via the pool's canceller (see the
          // docstring for why not query.cancel()). Fire-once semantics of
          // cancel() are preserved by nulling the canceller ourselves.
          const cancellable = query as unknown as {
            canceller?: ((query: unknown) => Promise<unknown>) | null;
          };
          const canceller = cancellable.canceller;
          if (canceller) {
            cancellable.canceller = null;
            canceller(query).catch((error: unknown) => {
              // A cancel failure means the timed-out query may keep holding
              // its connection and server-side locks while the caller only
              // saw a generic timeout -- a real operational signal. This
              // package has no logger wiring; console.error beats silence.
              console.error(
                "[db] cancelling a timed-out query failed; it may still hold a connection",
                error,
              );
            });
          }
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
