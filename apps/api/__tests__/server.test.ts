import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn<(callback: (error?: Error) => void) => void>(),
  closeDb: vi.fn<() => Promise<void>>(),
  flush: vi.fn<() => Promise<void>>(),
}));
vi.mock("~/instrument", () => ({}));
vi.mock("~/app", () => ({ app: { fetch: vi.fn() } }));
vi.mock("~/env", () => ({ env: { F3_API_HOST: "127.0.0.1" } }));
vi.mock("~/lib/logging", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@hono/node-server", () => ({ serve: () => ({ close: mocks.close }) }));
vi.mock("@acme/db/client", () => ({ closeDb: mocks.closeDb }));
vi.mock("@acme/observability", () => ({ flushObservability: mocks.flush }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("drains HTTP before closing the database and keeps the deadline through cleanup", async () => {
  vi.useFakeTimers();
  let terminate!: () => void;
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGTERM") terminate = listener as () => void;
    return process;
  });
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  let finishDb!: () => void;
  let finishFlush!: () => void;
  mocks.closeDb.mockReturnValueOnce(
    new Promise((resolve) => {
      finishDb = resolve;
    }),
  );
  mocks.flush.mockReturnValueOnce(
    new Promise((resolve) => {
      finishFlush = resolve;
    }),
  );
  await import("../src/server");
  terminate();
  terminate();
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.closeDb).not.toHaveBeenCalled();
  mocks.close.mock.calls[0]![0]();
  expect(mocks.closeDb).toHaveBeenCalledTimes(1);
  expect(mocks.flush).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(7_000);
  expect(exit).not.toHaveBeenCalled();
  finishDb();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.flush).toHaveBeenCalledExactlyOnceWith(2000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(exit).toHaveBeenCalledWith(1);
  finishFlush();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["http", "database", "observability", "success"])(
  "clears the shutdown deadline after %s completion",
  async (phase) => {
    vi.useFakeTimers();
    let terminate!: () => void;
    vi.spyOn(process, "on").mockImplementation((event, listener) => {
      if (event === "SIGTERM") terminate = listener as () => void;
      return process;
    });
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const failure = new Error("cleanup failure");
    mocks.closeDb.mockResolvedValue(undefined);
    mocks.flush.mockResolvedValue(undefined);
    if (phase === "database") mocks.closeDb.mockRejectedValueOnce(failure);
    if (phase === "observability") mocks.flush.mockRejectedValueOnce(failure);
    await import("../src/server");
    terminate();
    mocks.close.mock.calls[0]![0](phase === "http" ? failure : undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenNthCalledWith(1, phase === "success" ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
    const calls = exit.mock.calls.length;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(exit).toHaveBeenCalledTimes(calls);
  },
);
