import { createLogger, setErrorReporter } from "./index";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  setErrorReporter(() => undefined);
  vi.restoreAllMocks();
});

describe("shared audit diagnostic boundary", () => {
  it("discards non-string identifiers and invalid SQLSTATEs", () => {
    const instance = createLogger("audit-test");
    vi.spyOn(instance.logger, "error").mockImplementation(() => undefined);
    const reporter = vi.fn();
    setErrorReporter(reporter);
    instance.logError(
      "api.audit.failed",
      {},
      Object.assign(new Error("Audit history capture failed"), {
        code: "invalid",
        schema_name: 42,
        table_name: { secret: "synthetic-secret" },
      }),
    );
    expect(reporter.mock.lastCall?.[2]).toMatchObject({
      message: "Audit history capture failed",
      code: undefined,
    });
    expect(JSON.stringify(reporter.mock.lastCall)).not.toContain(
      "synthetic-secret",
    );
  });

  it("keeps reporter failures out of the request flow", () => {
    const instance = createLogger("audit-test");
    const output = vi
      .spyOn(instance.logger, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("Synthetic reporter failure");
    setErrorReporter(() => {
      throw failure;
    });
    expect(() => instance.logError("api.audit.failed")).not.toThrow();
    expect(output).toHaveBeenLastCalledWith(
      { err: failure, event: "api.audit.failed" },
      "logger.error_reporter_failed",
    );
  });

  it.each(["error", "fatal"] as const)(
    "sanitizes %s context without changing the caller's object",
    (level) => {
      const instance = createLogger("audit-test");
      const output = vi
        .spyOn(instance.logger, level)
        .mockImplementation(() => undefined);
      const reporter = vi.fn();
      setErrorReporter(reporter);
      const auditError = Object.assign(
        new Error("Audit history capture failed"),
        {
          code: "AH002",
          schema_name: "public",
          table_name: "api_keys",
          query: "synthetic-secret",
          params: ["synthetic-secret"],
        },
      );
      const wrapped = new Error("synthetic-secret", {
        cause: new Error("wrapper", { cause: auditError }),
      });
      const ctx = { err: wrapped, requestId: "synthetic-request" };
      (level === "error" ? instance.logError : instance.logFatal)(
        "api.audit.failed",
        ctx,
      );
      const safeCtx = reporter.mock.lastCall?.[1] as {
        err: Error;
        requestId: string;
      };
      expect(safeCtx).toMatchObject({
        requestId: "synthetic-request",
        err: {
          message: "Audit history capture failed",
          code: "AH002",
          schema_name: "public",
          table_name: "api_keys",
        },
      });
      expect(safeCtx.err.cause).toBeUndefined();
      expect(JSON.stringify(safeCtx)).not.toContain("synthetic-secret");
      expect(output).toHaveBeenCalledWith(safeCtx, "api.audit.failed");
      expect(ctx.err).toBe(wrapped);
    },
  );

  it("preserves errors with a non-Error cause", () => {
    const instance = createLogger("audit-test");
    vi.spyOn(instance.logger, "error").mockImplementation(() => undefined);
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const error = new Error("Unrelated failure", { cause: "not an Error" });
    instance.logError("api.other.failed", {}, error);
    expect(reporter.mock.lastCall?.[2]).toBe(error);
  });

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
