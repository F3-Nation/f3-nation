import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logInfo, logWarn } from "@/lib/logging";

function getLoggedJson(spy: ReturnType<typeof vi.spyOn>, callIndex = 0) {
  const payload = spy.mock.calls[callIndex]?.[0];
  expect(typeof payload).toBe("string");
  return JSON.parse(payload as string) as Record<string, unknown>;
}

describe("logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs INFO with context to console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logInfo("me.test.info", { requestId: "abc123" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = getLoggedJson(logSpy);
    expect(parsed.severity).toBe("INFO");
    expect(parsed.event).toBe("me.test.info");
    expect(parsed.service).toBe("f3-me");
    expect(parsed.requestId).toBe("abc123");
  });

  it("logs WARNING via console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logWarn("me.test.warn");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = getLoggedJson(logSpy);
    expect(parsed.severity).toBe("WARNING");
    expect(parsed.event).toBe("me.test.warn");
  });

  it("logs ERROR with serialized Error details", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const err = new Error("boom");
    (err as Error & { cause?: unknown }).cause = "root-cause";

    logError("me.test.error", { sessionUserId: 42 }, err);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = getLoggedJson(errorSpy);
    expect(parsed.severity).toBe("ERROR");
    expect(parsed.event).toBe("me.test.error");
    expect(parsed.sessionUserId).toBe(42);
    expect(parsed.errorName).toBe("Error");
    expect(parsed.errorMessage).toBe("boom");
    expect(parsed.errorCause).toBe("root-cause");
  });

  it("serializes non-Error circular values safely", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logError("me.test.circular", {}, circular);

    const parsed = getLoggedJson(errorSpy);
    expect(parsed.errorValue).toBe("[Circular]");
  });

  it("falls back when context cannot be JSON-stringified", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const circularContext: Record<string, unknown> = {};
    circularContext.self = circularContext;

    logInfo("me.test.context.circular", { circularContext });

    const parsed = getLoggedJson(logSpy);
    expect(parsed.severity).toBe("INFO");
    expect(parsed.event).toBe("me.test.context.circular");
    expect(parsed.serializeError).toBe("payload had circular references");
  });
});
