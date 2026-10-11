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

  it("stamps the configured service.name onto the event", async () => {
    // End-to-end through the REAL LoggerProvider (only posthog-node is
    // mocked): service.name is a Resource attribute, not a record attribute,
    // so this is the only test that proves the resource actually reaches the
    // exporter. Both apps share one PostHog project, so this property is the
    // only thing separating an "api" error from a "map" one.
    const { registerObservability, captureException } = await freshModule();
    registerObservability({ ...config, serviceName: "map" });
    await captureException(new Error("boom"));
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties["service.name"]).toBe("map");
  });

  it("callers cannot spoof service.name", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("boom"), { "service.name": "map" });
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties["service.name"]).toBe("api");
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

describe("captureException root cause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type Captured = [Error, undefined, Record<string, unknown>];

  it("reports the driver error behind a real DrizzleQueryError, with params redacted", async () => {
    // A genuine Drizzle failure, not a hand-built lookalike: a query against
    // a closed port makes drizzle-orm wrap postgres.js's ECONNREFUSED in its
    // own `Failed query: …\nparams: …` error — the shape every api/map
    // database failure arrives in, and the one a connection-failure alert
    // has to see through.
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { sql } = await import("drizzle-orm");
    const client = postgres("postgres://u:p@127.0.0.1:1/db", {
      max: 1,
      connect_timeout: 2,
    });
    let dbError: unknown;
    try {
      await drizzle(client).execute(sql`select ${"pii@example.com"}::text`);
    } catch (err) {
      dbError = err;
    } finally {
      await client.end({ timeout: 1 });
    }
    expect((dbError as Error).message).toMatch(/^Failed query: /);

    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(dbError);

    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties.root_cause_message).toMatch(/ECONNREFUSED/);
    expect(properties.root_cause_type).toBe("Error");
    // The driver's code, a stable field to alert on.
    expect(properties.root_cause_code).toBe("ECONNREFUSED");
    // Re-attached as .cause so posthog-node emits a chained exception.
    expect((reported.cause as Error).message).toMatch(/ECONNREFUSED/);
    // The bound value never leaves the process — not in the message, the
    // stack, or any property.
    expect(reported.message).toContain("params: [redacted]");
    expect(
      JSON.stringify([reported.message, reported.stack, properties]),
    ).not.toContain("pii@example.com");
    // The cause attributes are folded into root_cause_*, not duplicated.
    expect(properties).not.toHaveProperty("exception.cause.message");
  });

  it("drops a stack it cannot safely redact instead of sending the params", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const error = new Error("Failed query: select $1\nparams: secret@x.com");
    // A stack whose header doesn't embed the message verbatim.
    error.stack = "Error: rewritten\n    at x (y.ts:1:1)\nparams: secret@x.com";
    await captureException(error);
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(reported.message).toBe(
      "Failed query: select $1\nparams: [redacted]",
    );
    expect(JSON.stringify([reported.stack, properties])).not.toContain(
      "secret@x.com",
    );
    // The withheld stack is marked, not silently absent.
    expect(properties["exception.stacktrace_dropped"]).toBe("redaction");
  });

  it("redacts the value a Postgres type error quotes back", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const cause = Object.assign(
      new Error('invalid input syntax for type uuid: "alice@example.com"'),
      { name: "PostgresError", code: "22P02" },
    );
    await captureException(
      new Error("Failed query: select $1\nparams: x", { cause }),
    );
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties.root_cause_message).toBe(
      'invalid input syntax for type uuid: "[redacted]"',
    );
    expect(properties.root_cause_code).toBe("22P02");
    const cause_ = reported.cause as Error;
    expect(
      JSON.stringify([reported.message, reported.stack, properties]) +
        cause_.message +
        (cause_.stack ?? ""),
    ).not.toContain("alice@example.com");
  });

  it("marks a cause stack withheld because redaction couldn't be verified", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const cause = new Error('bad input: "secret@x.com"');
    cause.stack = "Error: rewritten header\n    at x (y.ts:1:1)";
    await captureException(new Error("outer", { cause }));
    const [, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties["exception.cause.stacktrace_dropped"]).toBe("redaction");
    expect(JSON.stringify(properties)).not.toContain("secret@x.com");
  });

  it("omits root_cause_code when the cause has none", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("outer", { cause: new Error("inner") }));
    const [, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties).not.toHaveProperty("root_cause_code");
  });

  it("reports a root cause that has no stack", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    cause.stack = undefined;
    await captureException(new Error("outer", { cause }));
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties.root_cause_message).toBe(
      "connect ECONNREFUSED 127.0.0.1:5432",
    );
    expect(reported.cause).toBeInstanceOf(Error);
  });

  it("still reports an error whose cause getter throws", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const error = new Error("outer");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("getter boom");
      },
    });
    await captureException(error);
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(reported.message).toBe("outer");
    expect(properties).not.toHaveProperty("root_cause_message");
  });

  it("omits root_cause_* for an error without a cause", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("boom"));
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(reported.cause).toBeUndefined();
    expect(properties).not.toHaveProperty("root_cause_message");
  });

  it("preserves a sanitized audit SQLSTATE without restoring its cause", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const error = Object.assign(new Error("Audit history capture failed"), {
      code: "AH002",
    });
    await captureException(error);
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(reported.cause).toBeUndefined();
    expect(properties.root_cause_code).toBe("AH002");
    expect(properties).not.toHaveProperty("root_cause_message");
  });

  it.each([
    ["an unrelated error", "ordinary failure", "ABCDE"],
    ["an invalid audit code", "Audit history capture failed", "not-sqlstate"],
  ])("does not promote the code from %s", async (_case, message, code) => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(Object.assign(new Error(message), { code }));
    const [, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties).not.toHaveProperty("root_cause_code");
  });

  it("ignores an error code getter that throws", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const error = new Error("Audit history capture failed");
    Object.defineProperty(error, "code", {
      get() {
        throw new Error("unsafe getter");
      },
    });
    await captureException(error);
    const [, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties).not.toHaveProperty("root_cause_code");
  });

  it("ignores a root cause code getter that throws", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    const cause = new Error("inner failure");
    Object.defineProperty(cause, "code", {
      get() {
        throw new Error("unsafe getter");
      },
    });
    await captureException(new Error("outer failure", { cause }));
    const [, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties.root_cause_message).toBe("inner failure");
    expect(properties).not.toHaveProperty("root_cause_code");
  });

  it("callers cannot inject a root cause onto an error without one", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(new Error("no cause"), {
      root_cause_message: "spoofed",
      root_cause_code: "spoofed",
      "exception.cause.message": "spoofed",
      "exception.cause.code": "spoofed",
      "exception.stacktrace_dropped": "spoofed",
    });
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(reported.cause).toBeUndefined();
    expect(properties).not.toHaveProperty("root_cause_message");
    expect(properties).not.toHaveProperty("exception.cause.message");
    expect(properties).not.toHaveProperty("root_cause_code");
    expect(properties).not.toHaveProperty("exception.stacktrace_dropped");
  });

  it("callers cannot spoof the root cause", async () => {
    const { registerObservability, captureException } = await freshModule();
    registerObservability(config);
    await captureException(
      new Error("outer", { cause: new Error("real cause") }),
      {
        root_cause_message: "spoofed",
        "exception.cause.message": "spoofed",
      },
    );
    const [reported, , properties] = captureExceptionImmediateMock.mock
      .calls[0] as Captured;
    expect(properties.root_cause_message).toBe("real cause");
    expect((reported.cause as Error).message).toBe("real cause");
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

describe("registerLoggerErrorReporter redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts sensitive context before it leaves the process", async () => {
    const { registerObservability, registerLoggerErrorReporter } =
      await freshModule();
    registerObservability(config);
    registerLoggerErrorReporter();
    const reporter = setErrorReporterMock.mock.calls[0]?.[0] as (
      event: string,
      ctx: Record<string, unknown>,
      err?: unknown,
    ) => void;

    reporter("api.auth.failed", {
      orgId: 7,
      authorization: "Bearer abc123",
      request: { headers: { cookie: "session=xyz" } },
    });

    await vi.waitFor(() => {
      expect(captureExceptionImmediateMock).toHaveBeenCalled();
    });
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties.orgId).toBe(7);
    expect(properties.authorization).toBe("[redacted]");
    // Nested values are stringified into the attribute, so assert on the
    // serialized form rather than the object shape.
    expect(JSON.stringify(properties)).not.toContain("abc123");
    expect(JSON.stringify(properties)).not.toContain("session=xyz");
  });
});

describe("flushObservability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op before registerObservability is called", async () => {
    const { flushObservability } = await freshModule();
    await expect(flushObservability()).resolves.toBeUndefined();
  });

  it("resolves after a registered pipeline flushes", async () => {
    const { registerObservability, captureException, flushObservability } =
      await freshModule();
    registerObservability(config);
    await captureException(new Error("boom"));

    await expect(flushObservability()).resolves.toBeUndefined();
  });

  it("resolves rather than rejecting when the flush itself fails", async () => {
    const { registerObservability, flushObservability } = await freshModule();
    registerObservability(config);
    captureExceptionImmediateMock.mockRejectedValueOnce(
      new Error("posthog down"),
    );

    // Shutdown must never be blocked or diverted by the error tracker.
    await expect(flushObservability(50)).resolves.toBeUndefined();
  });
});
