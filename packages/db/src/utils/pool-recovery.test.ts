import { afterEach, describe, expect, it, vi } from "vitest";

import { createRecoveringPool } from "./pool-recovery";

const logging = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock("../lib/logging", () => logging);
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

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
    for (let count = 0; count < 3; count++) pools[0]!.timeout();
    pools[0]!.success();
    expect(manager.db.identity).toBe(2);
    expect(
      logging.logWarn.mock.calls.filter(
        ([event]) => event === "db.query.deadline_exceeded",
      ),
    ).toEqual(
      Array.from({ length: 6 }, () => [
        "db.query.deadline_exceeded",
        { generation: 0 },
      ]),
    );
    expect(logging.logWarn).toHaveBeenCalledWith("db.pool.recycled", {
      generation: 1,
      timeoutCount: 3,
    });
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
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    for (let count = 0; count < 3; count++) observers[1]!.timeout();
    observers[1]!.success();
    expect(observers).toHaveLength(2);
    finish();
    await closing;
    expect(close).toHaveBeenCalledTimes(2);
    expect(closed).toBe(true);
    for (let count = 0; count < 3; count++) observers[1]!.timeout();
    expect(observers).toHaveLength(2);
    expect(close).toHaveBeenCalledTimes(2);
  });
});

it("never dispatches a retiring write to its successor", async () => {
  let finish!: (value: number) => void;
  const pending = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const observers: { timeout: () => void; success: () => void }[] = [];
  const writes: ReturnType<typeof vi.fn>[] = [];
  const manager = createRecoveringPool((observer) => {
    observers.push(observer);
    const write = vi.fn<() => Promise<number>>().mockReturnValue(pending);
    writes.push(write);
    return { db: { write }, close: () => Promise.resolve() };
  });
  const original = manager.db.write();
  for (let count = 0; count < 3; count++) observers[0]!.timeout();
  expect(writes).toHaveLength(2);
  finish(42);
  expect(await original).toBe(42);
  expect(writes[0]).toHaveBeenCalledTimes(1);
  expect(writes[1]).not.toHaveBeenCalled();
  await manager.close();
});

it("reports retirement failures without exposing driver details or rejecting shutdown", async () => {
  const observers: { timeout: () => void; success: () => void }[] = [];
  const manager = createRecoveringPool((observer) => {
    observers.push(observer);
    return {
      db: {},
      close: () => Promise.reject(new Error("private driver details")),
    };
  });
  for (let count = 0; count < 3; count++) observers[0]!.timeout();
  await expect(manager.close()).resolves.toBeUndefined();
  expect(logging.logError).toHaveBeenCalledTimes(2);
  expect(logging.logError).toHaveBeenCalledWith(
    "db.pool.retirement_failed",
    {},
  );
});
