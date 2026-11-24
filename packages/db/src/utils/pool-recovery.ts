import { logError, logWarn } from "../lib/logging";

export interface QueryObserver {
  success: () => void;
  timeout: () => void;
}

interface Pool<T> {
  db: T;
  close: (options: { timeout: number }) => Promise<void>;
}

/** Per-instance recovery; retired operations retain their original outcome. */
export function createRecoveringPool<T extends object>(
  create: (observer: QueryObserver) => Pool<T>,
) {
  let generation = 0;
  let consecutiveTimeouts = 0;
  let stopped = false;
  let failedRecoveryAt: number | undefined;
  let live = true;
  const retiring = new Set<Promise<void>>();

  const retire = (pool: Pool<T>) => {
    const closing = Promise.resolve()
      .then(() => pool.close({ timeout: 5 }))
      .catch(() => {
        logError("db.pool.retirement_failed", {});
      });
    retiring.add(closing);
    void closing.then(() => retiring.delete(closing));
    return closing;
  };

  const build = (): Pool<T> => {
    const id = generation;
    return create({
      success: () => {
        if (stopped || id !== generation) return;
        consecutiveTimeouts = 0;
        failedRecoveryAt = undefined;
        live = true;
      },
      timeout: () => {
        if (stopped || id !== generation) return;
        logWarn("db.query.deadline_exceeded", { generation: id });
        if (id > 0) {
          failedRecoveryAt ??= performance.now();
          if (performance.now() - failedRecoveryAt >= 60_000) live = false;
        }
        if (++consecutiveTimeouts < 3) return;
        const old = current;
        generation++;
        consecutiveTimeouts = 0;
        current = build();
        logWarn("db.pool.recycled", { generation, timeoutCount: 3 });
        void retire(old);
      },
    });
  };
  let current = build();
  let closing: Promise<void> | undefined;
  return {
    db: new Proxy({} as T, {
      get(_target, prop) {
        const db = current.db;
        const value: unknown = Reflect.get(db, prop);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(db)
          : value;
      },
    }),
    isLive: () => live,
    close: () => {
      stopped = true;
      closing ??= Promise.all([retire(current), ...retiring]).then(
        () => undefined,
      );
      return closing;
    },
  };
}
