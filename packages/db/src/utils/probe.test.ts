import { afterEach, expect, it, vi } from "vitest";
import { createDbClient } from "./functions";
const driver = vi.hoisted(() => ({ unsafe: vi.fn<() => Promise<unknown>>() }));
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
afterEach(() => vi.useRealTimers());
it("holds one native probe beyond the ordinary query deadline and releases it after settlement", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  driver.unsafe.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = createDbClient({ recover: true });
  const first = client.check();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(client.check()).toBe(first);
  expect(driver.unsafe).toHaveBeenCalledExactlyOnceWith("select 1");
  finish([]);
  await expect(first).resolves.toBeUndefined();
  driver.unsafe.mockResolvedValueOnce([]);
  await expect(client.check()).resolves.toBeUndefined();
  expect(driver.unsafe).toHaveBeenCalledTimes(2);
  driver.unsafe.mockRejectedValueOnce(new Error("connection closed"));
  await expect(client.check()).rejects.toThrow("connection closed");
  driver.unsafe.mockResolvedValueOnce([]);
  await expect(client.check()).resolves.toBeUndefined();
  expect(driver.unsafe).toHaveBeenCalledTimes(4);
  await client.close();
});
