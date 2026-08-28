import { beforeEach, describe, expect, it, vi } from "vitest";

const captureExceptionImmediateMock = vi.hoisted(() => vi.fn());
const PostHogMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: unknown) {
    Object.assign(this as object, {
      captureExceptionImmediate: captureExceptionImmediateMock,
      shutdown: vi.fn(),
    });
  }),
);
const setErrorReporterMock = vi.hoisted(() => vi.fn());

vi.mock("posthog-node", () => ({ PostHog: PostHogMock }));
vi.mock("@acme/logger", () => ({
  setErrorReporter: setErrorReporterMock,
}));

async function freshModule() {
  vi.resetModules();
  return import("./index");
}

const config = {
  serviceName: "api",
  environment: "ci",
  posthog: { apiKey: "test-key" },
};

describe("captureException", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op before registerObservability is called", async () => {
    const { captureException } = await freshModule();
    await captureException(new Error("boom"));
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("is a no-op when no PostHog key is configured", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability({ serviceName: "api", environment: "ci" });
    await captureException(new Error("boom"));
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("captures an exception with the environment and extra attributes", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const error = new Error("boom");
    await captureException(error, { route: "/v1/test" });
    expect(captureExceptionImmediateMock).toHaveBeenCalledOnce();
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as [Error, undefined, Record<string, unknown>];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("boom");
    expect(reported.stack).toBe(error.stack);
    expect(properties).toMatchObject({ environment: "ci", route: "/v1/test" });
  });

  it("preserves the original error name for grouping", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    class DatabaseTimeoutError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "DatabaseTimeoutError";
      }
    }
    await captureException(new DatabaseTimeoutError("pool exhausted"));
    const [reported] = captureExceptionImmediateMock.mock.calls[0] as [Error];
    expect(reported.name).toBe("DatabaseTimeoutError");
  });

  it("wraps non-Error values in a real Error", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException("not an error");
    const [reported] = captureExceptionImmediateMock.mock.calls[0] as [Error];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("not an error");
  });

  it("never rejects even when String(err) itself throws", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const hostile = {
      toString() {
        throw new Error("hostile toString");
      },
    };
    await expect(captureException(hostile)).resolves.toBeUndefined();
    const [reported] = captureExceptionImmediateMock.mock.calls[0] as [Error];
    expect(reported.message).toBe("[unstringifiable error value]");
  });

  it("logs (but never throws) when the PostHog transport fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    captureExceptionImmediateMock.mockRejectedValueOnce(
      new Error("network down"),
    );
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await expect(captureException(new Error("boom"))).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "posthog.capture_exception_failed",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("callers cannot spoof the exception attributes", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("real message"), {
      "exception.message": "spoofed",
      environment: "spoofed-env",
    });
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as [Error, undefined, Record<string, unknown>];
    expect(reported.message).toBe("real message");
    expect(properties.environment).toBe("ci");
  });

  it("stringifies non-primitive attribute values instead of dropping them", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("boom"), {
      nested: { a: 1 },
      count: 3,
      skipped: undefined,
    });
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties.nested).toBe('{"a":1}');
    expect(properties.count).toBe(3);
    expect("skipped" in properties).toBe(false);
  });

  it("logs (but never throws) when the pipeline itself fails", async () => {
    // Covers captureException's own catch — distinct from the exporter's
    // catch (tested above via a transport failure): here emit() explodes
    // before any record reaches the exporter.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const hostileAttrs = {};
    Object.defineProperty(hostileAttrs, "route", {
      enumerable: true,
      get() {
        throw new Error("hostile attribute getter");
      },
    });
    await expect(
      captureException(new Error("boom"), hostileAttrs),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "observability.capture_exception_failed",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("constructs the PostHog client with a bounded timeout and no retries", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("boom"));
    expect(PostHogMock).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ requestTimeout: 3000, fetchRetryCount: 0 }),
    );
  });

  it("reuses one PostHog client across multiple calls", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("first"));
    await captureException(new Error("second"));
    expect(PostHogMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionImmediateMock).toHaveBeenCalledTimes(2);
  });
});

describe("registerObservability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is idempotent — the first registration wins", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    registerObservability({ ...config, environment: "second-call" });
    await captureException(new Error("boom"));
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties.environment).toBe("ci");
  });
});

describe("registerLoggerErrorReporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a reporter that cannot have its event overwritten by ctx", async () => {
    const { registerObservability, registerLoggerErrorReporter } =
      await freshModule();
    registerObservability(config);
    registerLoggerErrorReporter();
    expect(setErrorReporterMock).toHaveBeenCalledOnce();
    const reporter = setErrorReporterMock.mock.calls[0]?.[0] as (
      event: string,
      ctx: Record<string, unknown>,
      err?: unknown,
    ) => void;

    reporter("real.event", { event: "spoofed.event", userId: "123" });
    // Let the fire-and-forget captureException call settle.
    await vi.waitFor(() => {
      expect(captureExceptionImmediateMock).toHaveBeenCalled();
    });
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as [Error, undefined, Record<string, unknown>];
    expect(reported.message).toBe("real.event");
    expect(properties).toMatchObject({
      environment: "ci",
      userId: "123",
      event: "real.event",
    });
  });

  it("forwards a real error when the log call carried one", async () => {
    const { registerObservability, registerLoggerErrorReporter } =
      await freshModule();
    registerObservability(config);
    registerLoggerErrorReporter();
    const reporter = setErrorReporterMock.mock.calls[0]?.[0] as (
      event: string,
      ctx: Record<string, unknown>,
      err?: unknown,
    ) => void;

    const original = new Error("db exploded");
    reporter("db.query_failed", {}, original);
    await vi.waitFor(() => {
      expect(captureExceptionImmediateMock).toHaveBeenCalled();
    });
    const [reported] = captureExceptionImmediateMock.mock.calls[0] as [Error];
    expect(reported.message).toBe("db exploded");
    expect(reported.stack).toBe(original.stack);
  });
});
