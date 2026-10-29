import { afterEach, describe, expect, it, vi } from "vitest";

const logFatal = vi.fn();
vi.mock("./lib/logging", () => ({ logFatal }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("./env");
});

describe("register", () => {
  it("exits the process when the env schema rejects the config", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.doMock("./env", () => {
      throw new Error("Invalid environment variables");
    });
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    const { register } = await import("./instrumentation");
    await register();

    expect(logFatal).toHaveBeenCalledWith(
      "region_pages.startup.invalid_env",
      {},
      expect.any(Error),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const exit = vi.spyOn(process, "exit");

    const { register } = await import("./instrumentation");
    await register();

    expect(exit).not.toHaveBeenCalled();
  });
});
