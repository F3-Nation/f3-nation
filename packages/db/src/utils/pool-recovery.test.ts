import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecoveringPool } from "./pool-recovery";

afterEach(() => vi.useRealTimers());

describe("pool recovery", () => {
  it("switches future work after three timeouts and drains without replay", async () => {
    const pools: {
      timeout: () => void;
      success: () => void;
      close: ReturnType<typeof vi.fn>;
    }[] = [];
    const manager = createRecoveringPool((observer) => {
      const pool = { ...observer, close: vi.fn().mockResolvedValue(undefined) };
      pools.push(pool);
      return { db: { identity: pools.length }, close: pool.close };
    });
    expect(manager.db.identity).toBe(1);
    pools[0]!.timeout();
    pools[0]!.timeout();
    expect(manager.db.identity).toBe(1);
    pools[0]!.timeout();
    expect(manager.db.identity).toBe(2);
    await Promise.resolve();
    expect(pools[0]!.close).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
    pools[0]!.timeout();
    pools[0]!.success();
    expect(manager.db.identity).toBe(2);
    await manager.close();
    pools[1]!.timeout();
    expect(pools).toHaveLength(2);
    expect(pools[1]!.close).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
  });

  it("resets on success and retains failed-recovery evidence across generations", async () => {
    vi.useFakeTimers();
    const observers: { timeout: () => void; success: () => void }[] = [];
    const manager = createRecoveringPool((observer) => {
      observers.push(observer);
      return { db: {}, close: () => Promise.resolve() };
    });
    const fail = (index: number) => observers[index]!.timeout();
    fail(0);
    fail(0);
    observers[0]!.success();
    fail(0);
    expect(observers).toHaveLength(1);
    fail(0);
    fail(0);
    expect(observers).toHaveLength(2);
    expect(manager.isLive()).toBe(true);
    fail(1);
    fail(1);
    fail(1);
    expect(observers).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(manager.isLive()).toBe(true);
    fail(2);
    expect(manager.isLive()).toBe(false);
    observers[1]!.success();
    expect(manager.isLive()).toBe(false);
    observers[2]!.success();
    expect(manager.isLive()).toBe(true);
    await manager.close();
  });

  it("waits for a draining pool on shutdown and closes each pool only once", async () => {
    const observers: { timeout: () => void; success: () => void }[] = [];
    let finish!: () => void;
    const drain = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const close = vi
      .fn()
      .mockReturnValueOnce(drain)
      .mockResolvedValue(undefined);
    const manager = createRecoveringPool((observer) => {
      observers.push(observer);
      return {
        db: {
          value: 42,
          read() {
            return this.value;
          },
        },
        close,
      };
    });
    observers[0]!.timeout();
    observers[0]!.timeout();
    observers[0]!.timeout();
    expect(manager.db.read()).toBe(42);
    let closed = false;
    const closing = manager.close().then(() => {
      closed = true;
    });
    expect(manager.close()).toBe(manager.close());
    await Promise.resolve();
    expect(closed).toBe(false);
    observers[1]!.timeout();
    observers[1]!.success();
    expect(observers).toHaveLength(2);
    finish();
    await closing;
    expect(close).toHaveBeenCalledTimes(2);
    expect(closed).toBe(true);
  });
});
