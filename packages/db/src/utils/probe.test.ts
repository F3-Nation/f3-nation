import { afterEach, expect, it, vi } from "vitest";
import { createDbClient } from "./functions";
const driver = vi.hoisted(() => {
  vi.stubEnv("QUERY_TIMEOUT_MS", "60000");
  return { unsafe: vi.fn<() => { then: Promise<unknown>["then"] }>() };
});
vi.mock("@acme/env", () => ({
  env: { TEST_DATABASE_URL: "postgres://u:p@localhost/test" },
}));
vi.mock("@acme/shared/common/constants", () => ({ isTest: true }));
vi.mock("postgres", () => ({
  default: () => ({
    unsafe: driver.unsafe,
    begin: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    options: { parsers: {}, serializers: {} },
  }),
}));
const native = (promise: Promise<unknown>) => ({
  then: promise.then.bind(promise),
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("holds one native probe beyond the ordinary query deadline and releases it after settlement", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  driver.unsafe.mockReturnValueOnce(
    native(
      new Promise((resolve) => {
        finish = resolve;
      }),
    ),
  );
  const client = createDbClient({ recover: true });
  const first = client.check();
  driver.unsafe.mockReturnValueOnce(native(new Promise(() => undefined)));
  const ordinary = Promise.resolve(client.db.$client.unsafe("select 42")).catch(
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await ordinary).toMatchObject({
    message: "Query exceeded 60000ms pool-wait/execution timeout",
  });
  expect(client.check()).toBe(first);
  expect(driver.unsafe).toHaveBeenCalledTimes(2);
  expect(driver.unsafe).toHaveBeenNthCalledWith(1, "select 1");
  finish([]);
  await expect(first).resolves.toBeUndefined();
  driver.unsafe.mockReturnValueOnce(native(Promise.resolve([])));
  await expect(client.check()).resolves.toBeUndefined();
  expect(driver.unsafe).toHaveBeenCalledTimes(3);
  driver.unsafe.mockReturnValueOnce(
    native(Promise.reject(new Error("connection closed"))),
  );
  await expect(client.check()).rejects.toThrow("connection closed");
  driver.unsafe.mockReturnValueOnce(native(Promise.resolve([])));
  await expect(client.check()).resolves.toBeUndefined();
  expect(driver.unsafe).toHaveBeenCalledTimes(5);
  await client.close();
});
