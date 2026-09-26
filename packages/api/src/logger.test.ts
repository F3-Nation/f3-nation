import { createLogger, setErrorReporter } from "@acme/logger";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  setErrorReporter(() => undefined);
  vi.restoreAllMocks();
});

describe("shared audit diagnostic boundary", () => {
  it("serializes sanitized errors through real pino and child loggers", async () => {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "src/__tests__/fixtures/audit-log-output.ts"],
      { env: { ...process.env, NODE_ENV: "production" }, timeout: 10000 },
    );
    expect(stderr).toBe("");
    expect(stdout).not.toContain("synthetic-secret");
    const records = stdout
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            err: { message: string; code?: string; cause?: unknown };
            event: string;
          },
      );
    expect(records).toHaveLength(4);
    expect(records.map((record) => record.event)).toEqual([
      "audit.serializer.direct",
      "audit.serializer.child",
      "audit.serializer.direct",
      "audit.serializer.child",
    ]);
    for (const [index, record] of records.entries()) {
      expect(record.err.message).toBe("Audit history capture failed");
      expect(record.err.cause).toBeUndefined();
      expect(record.err.code).toBe(index < 2 ? "23514" : undefined);
    }
  });
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
