import type postgres from "postgres";

/**
 * postgres-js has no option for how long a query may wait behind a
 * saturated connection pool -- `connect_timeout` only bounds opening a new
 * physical connection (see #905). This wraps `client.unsafe()`, the single
 * chokepoint every drizzle-orm postgres-js query goes through (verified
 * against drizzle-orm's postgres-js/session.js: `execute`, `all`, `query`,
 * and `queryObjects` all call `client.unsafe()`), so a query that hasn't
 * settled within `timeoutMs` is cancelled instead of hanging the request
 * indefinitely.
 *
 * `query.cancel()` (postgres-js's own API, verified against its source)
 * does the right thing either way: evicts the query from the pool's
 * internal queue if it hasn't been dispatched to a connection yet, or sends
 * a real Postgres CancelRequest if it's already running on one.
 *
 * Known gap: only wraps the top-level client passed in. Queries run inside
 * `db.transaction()` execute against a separately-scoped client postgres-js
 * hands to the transaction callback, which isn't wrapped here.
 */
export function withQueryTimeout(client: postgres.Sql, timeoutMs: number) {
  const originalUnsafe = client.unsafe.bind(client);
  client.unsafe = ((...args: Parameters<typeof originalUnsafe>) => {
    const query = originalUnsafe(...args);
    const timer = setTimeout(() => query.cancel(), timeoutMs);
    const originalThen = query.then.bind(query);
    query.then = ((
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) =>
      originalThen(
        (value: unknown) => {
          clearTimeout(timer);
          return onFulfilled ? onFulfilled(value) : value;
        },
        (err: unknown) => {
          clearTimeout(timer);
          if (onRejected) return onRejected(err);
          throw err;
        },
      )) as typeof query.then;
    return query;
  }) as typeof client.unsafe;
}
