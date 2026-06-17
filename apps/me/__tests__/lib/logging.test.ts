import { afterEach, describe, expect, it, vi } from "vitest";

interface LoggedCall {
  level: string;
  ctx: Record<string, unknown>;
  event: string;
}

let loggedCalls: LoggedCall[] = [];
let createLoggerArgs: unknown[] = [];

async function loadLoggingModule() {
  loggedCalls = [];
  createLoggerArgs = [];

  vi.resetModules();
  vi.doMock("@acme/logger", () => {
    const loggerApi = {
      logger: { child: vi.fn() },
      logTrace: (event: string, ctx: Record<string, unknown> = {}) => {
        loggedCalls.push({ level: "trace", ctx, event });
      },
      logDebug: (event: string, ctx: Record<string, unknown> = {}) => {
        loggedCalls.push({ level: "debug", ctx, event });
      },
      logInfo: (event: string, ctx: Record<string, unknown> = {}) => {
        loggedCalls.push({ level: "info", ctx, event });
      },
      logWarn: (event: string, ctx: Record<string, unknown> = {}) => {
        loggedCalls.push({ level: "warn", ctx, event });
      },
      logError: (
        event: string,
        ctx: Record<string, unknown> = {},
        err?: unknown,
      ) => {
        loggedCalls.push({
          level: "error",
          ctx: { ...ctx, ...(err !== undefined ? { err } : {}) },
          event,
        });
      },
      logFatal: (
        event: string,
        ctx: Record<string, unknown> = {},
        err?: unknown,
      ) => {
        loggedCalls.push({
          level: "fatal",
          ctx: { ...ctx, ...(err !== undefined ? { err } : {}) },
          event,
        });
      },
    };

    return {
      createLogger: vi.fn((...args: unknown[]) => {
        createLoggerArgs = args;
        return loggerApi;
      }),
    };
  });

  return import("@/lib/logging");
}

async function loadRealLoggingModule() {
  vi.doUnmock("@acme/logger");
  vi.resetModules();
  return import("@/lib/logging");
}

describe("logging", () => {
  afterEach(() => {
    vi.doUnmock("@acme/logger");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs INFO with context", async () => {
    const { logInfo } = await loadLoggingModule();

    logInfo("me.test.info", { requestId: "abc123" });

    expect(loggedCalls).toEqual([
      {
        level: "info",
        event: "me.test.info",
        ctx: { requestId: "abc123" },
      },
    ]);
    expect(createLoggerArgs).toEqual(["f3-me"]);
  });

  it("logs WARNING", async () => {
    const { logWarn } = await loadLoggingModule();

    logWarn("me.test.warn");

    expect(loggedCalls).toEqual([
      {
        level: "warn",
        event: "me.test.warn",
        ctx: {},
      },
    ]);
  });

  it("logs ERROR with error context", async () => {
    const { logError } = await loadLoggingModule();
    const err = new Error("boom");
    (err as Error & { cause?: unknown }).cause = "root-cause";

    logError("me.test.error", { sessionUserId: 42 }, err);

    expect(loggedCalls).toHaveLength(1);
    expect(loggedCalls[0]?.level).toBe("error");
    expect(loggedCalls[0]?.event).toBe("me.test.error");
    expect(loggedCalls[0]?.ctx.sessionUserId).toBe(42);
    expect(loggedCalls[0]?.ctx.err).toBe(err);
  });

  it("accepts non-Error circular values without throwing", async () => {
    const { logError } = await loadLoggingModule();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logError("me.test.circular", {}, circular)).not.toThrow();

    expect(loggedCalls).toHaveLength(1);
    expect(loggedCalls[0]?.level).toBe("error");
    expect(loggedCalls[0]?.ctx.err).toBe(circular);
  });

  it("accepts circular context without throwing", async () => {
    const { logInfo } = await loadLoggingModule();
    const circularContext: Record<string, unknown> = {};
    circularContext.self = circularContext;

    expect(() =>
      logInfo("me.test.context.circular", { circularContext }),
    ).not.toThrow();

    expect(loggedCalls).toEqual([
      {
        level: "info",
        event: "me.test.context.circular",
        ctx: { circularContext },
      },
    ]);
  });

  it("real logger handles Error and circular payloads for error/fatal", async () => {
    const { logError, logFatal } = await loadRealLoggingModule();

    const err = new Error("boom");
    (err as Error & { cause?: unknown }).cause = { reason: "root-cause" };

    const circularContext: Record<string, unknown> = {};
    circularContext.self = circularContext;

    const circularValue: Record<string, unknown> = {};
    circularValue.self = circularValue;

    expect(() => {
      logError("me.test.real.error", { circularContext }, err);
      logFatal("me.test.real.fatal", { sessionUserId: 42 }, circularValue);
    }).not.toThrow();
  });
});
