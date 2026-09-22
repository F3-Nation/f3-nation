import { createLogger, setErrorReporter } from "@acme/logger";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  setErrorReporter(() => undefined);
  vi.restoreAllMocks();
});

describe("shared audit diagnostic boundary", () => {
  it.each(["error", "fatal"] as const)(
    "sanitizes %s for every logger instance before pino and the reporter",
    (level) => {
      for (const service of ["acme-api", "f3-api", "acme-auth"]) {
        const instance = createLogger(service);
        const output = vi
          .spyOn(instance.logger, level)
          .mockImplementation(() => undefined);
        const reporter = vi.fn();
        setErrorReporter(reporter);
        const error = new Error("Failed query: params: synthetic-secret", {
          cause: Object.assign(new Error("Audit history capture failed"), {
            code: "23514",
          }),
        });
        const log = level === "error" ? instance.logError : instance.logFatal;
        log("api.audit.failed", {}, error);
        const safe = reporter.mock.lastCall?.[2] as Error & { code: string };
        expect(safe.message).toBe("Audit history capture failed");
        expect(safe.code).toBe("23514");
        expect(safe.cause).toBeUndefined();
        expect(safe.stack).not.toContain("synthetic-secret");
        expect(output).toHaveBeenCalledWith({ err: safe }, "api.audit.failed");
      }
    },
  );
  it("preserves unrelated errors and terminates on cyclic causes", () => {
    const instance = createLogger("audit-test");
    vi.spyOn(instance.logger, "error").mockImplementation(() => undefined);
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const other = new Error("Unrelated failure");
    other.cause = other;
    instance.logError("api.other.failed", {}, other);
    expect(reporter.mock.lastCall?.[2]).toBe(other);
  });
});
