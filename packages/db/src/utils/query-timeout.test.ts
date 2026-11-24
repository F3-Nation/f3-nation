import type postgres from "postgres";
import { afterEach, expect, it, vi } from "vitest";

import { withQueryTimeout } from "./query-timeout";

afterEach(() => vi.useRealTimers());

it("observes timely success but neither errors nor transaction BEGIN", async () => {
  const observer = { timeout: vi.fn(), success: vi.fn() };
  const unsafe = vi.fn().mockImplementation(() => ({
    then: Promise.resolve([42]).then.bind(Promise.resolve([42])),
  }));
  const client = { unsafe } as unknown as postgres.Sql;
  withQueryTimeout(client, 100, observer);
  expect(await client.unsafe("select 42")).toEqual([42]);
  expect(observer.success).toHaveBeenCalledTimes(1);
  const failure = new Error("driver failure");
  unsafe.mockImplementationOnce(() => {
    const pending = Promise.reject(failure);
    return { then: pending.then.bind(pending) };
  });
  await expect(client.unsafe("select 1")).rejects.toBe(failure);
  vi.useFakeTimers();
  let finishBegin!: (value: unknown) => void;
  const nativePromise = new Promise((resolve) => {
    finishBegin = resolve;
  });
  const native = { then: nativePromise.then.bind(nativePromise) };
  unsafe.mockReturnValueOnce(native);
  const begin = Promise.resolve(
    client.unsafe("begin", [], { onexecute: () => undefined } as never),
  );
  let settled = false;
  void begin.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.advanceTimersByTimeAsync(200);
  expect(settled).toBe(false);
  finishBegin([]);
  await expect(begin).resolves.toEqual([]);
  expect(observer.success).toHaveBeenCalledTimes(1);
  expect(observer.timeout).not.toHaveBeenCalled();
});

it("observes one deadline and ignores a late success", async () => {
  vi.useFakeTimers();
  const observer = { timeout: vi.fn(), success: vi.fn() };
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const client = {
    unsafe: () => ({ then: pending.then.bind(pending) }),
  } as unknown as postgres.Sql;
  withQueryTimeout(client, 100, observer);
  const query = client.unsafe("select 1");
  const rejected = query.then(undefined, (error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(await rejected).toMatchObject({
    message: "Query exceeded 100ms pool-wait/execution timeout",
  });
  expect(observer.timeout).toHaveBeenCalledTimes(1);
  finish([]);
  await Promise.resolve();
  expect(observer.success).not.toHaveBeenCalled();
  await expect(Promise.resolve(query)).rejects.toThrow("Query exceeded");
  expect(observer.timeout).toHaveBeenCalledTimes(1);
});
