import { AsyncLocalStorage } from "node:async_hooks";

import type postgres from "postgres";

export interface AuditContext {
  userId: number | null;
  source: string | null;
}

export const auditContext = new AsyncLocalStorage<AuditContext>();

/** Consume lazy query builders within the callback to retain attribution. */
export function runWithAuditContext<T>(store: AuditContext, fn: () => T): T {
  return auditContext.run(store, fn);
}

export function auditSettingsSql({ userId, source }: AuditContext): string {
  if (
    userId !== null &&
    (!Number.isInteger(userId) || userId < 1 || userId > 2_147_483_647)
  ) {
    throw new Error("Invalid audit user id");
  }
  if (
    source !== null &&
    (typeof source !== "string" || /[^a-z0-9-]/.test(source))
  ) {
    throw new Error("Invalid audit source");
  }
  return `set local app.user_id = '${userId ?? ""}'; set local app.source = '${source ?? ""}'`;
}

const writePattern = /^\s*(with\b[\s\S]*?\b)?(insert|update|delete|merge)\b/i;

function activeStore() {
  const store = auditContext.getStore();
  return store && (store.userId !== null || store.source !== null)
    ? store
    : undefined;
}

/**
 * Depends on Drizzle's postgres-js session routing statements through unsafe,
 * transactions through begin, and nested transactions through savepoint.
 * Transaction-local settings prevent attribution leaking across pooled users.
 * Install after withQueryTimeout: reads keep its pool-wait bound, while
 * attributed writes use native transactions and the role's statement_timeout.
 * The driver's onexecute BEGIN must retain its native query/reservation path.
 */
export function withAuditContext(client: postgres.Sql): void {
  const originalUnsafe = client.unsafe.bind(client);
  const originalBegin = client.begin.bind(client);
  type Callback = (tx: postgres.TransactionSql) => unknown;

  client.begin = ((options: string | Callback, callback?: Callback) => {
    const store = activeStore();
    if (!store) {
      return typeof options === "string"
        ? originalBegin(options, callback!)
        : originalBegin(options);
    }
    const settings = auditSettingsSql(store);
    const run = typeof options === "string" ? callback! : options;
    const attributed = async (tx: postgres.TransactionSql) => {
      await tx.unsafe(settings);
      const result = run(tx);
      // postgres-js resolves an immediate callback array with Promise.all.
      // An async wrapper hides that array from the driver's own detection.
      return Array.isArray(result) ? Promise.all(result) : result;
    };
    return typeof options === "string"
      ? originalBegin(options, attributed)
      : originalBegin(attributed);
  }) as typeof client.begin;

  client.unsafe = ((...args: Parameters<typeof originalUnsafe>) => {
    const store = activeStore();
    if (!store) return originalUnsafe(...args);
    const settings = auditSettingsSql(store);
    const options = args[2] as { onexecute?: unknown } | undefined;
    if (options?.onexecute || !writePattern.test(args[0])) {
      return originalUnsafe(...args);
    }

    let promise: Promise<unknown> | undefined;
    let values = false;
    const query = {
      then(
        onFulfilled?: ((value: unknown) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) {
        const returnValues = values;
        promise ??= originalBegin(async (tx) => {
          await tx.unsafe(settings);
          const pending = tx.unsafe(...args);
          return returnValues ? pending.values() : pending;
        });
        return promise.then(onFulfilled, onRejected);
      },
      values() {
        values = true;
        return query;
      },
    };
    return query;
  }) as typeof client.unsafe;
}
