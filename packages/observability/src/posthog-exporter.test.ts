import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { ExportResultCode } from "@opentelemetry/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureExceptionImmediateMock = vi.hoisted(() => vi.fn());
const shutdownMock = vi.hoisted(() => vi.fn());
const PostHogMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: unknown) {
    Object.assign(this as object, {
      captureExceptionImmediate: captureExceptionImmediateMock,
      shutdown: shutdownMock,
    });
  }),
);

vi.mock("posthog-node", () => ({ PostHog: PostHogMock }));

import { PostHogExceptionExporter } from "./posthog-exporter";

function record(attributes: Record<string, unknown>): ReadableLogRecord {
  return { attributes } as unknown as ReadableLogRecord;
}

function exportRecords(
  exporter: PostHogExceptionExporter,
  records: ReadableLogRecord[],
): Promise<ExportResultCode> {
  return new Promise((resolve) => {
    exporter.export(records, (result) => resolve(result.code));
  });
}

describe("PostHogExceptionExporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips records that carry no exception semantics", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    const code = await exportRecords(exporter, [
      record({ "some.plain": "log" }),
    ]);
    expect(code).toBe(ExportResultCode.SUCCESS);
    expect(captureExceptionImmediateMock).not.toHaveBeenCalled();
    // No exception records → the client is never even constructed.
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("reports export success even when every send fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    captureExceptionImmediateMock.mockRejectedValueOnce(
      new Error("network down"),
    );
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    const code = await exportRecords(exporter, [
      record({ "exception.message": "boom" }),
    ]);
    expect(code).toBe(ExportResultCode.SUCCESS);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "posthog.capture_exception_failed",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("honors a custom PostHog host", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      host: "https://eu.i.posthog.com",
      environment: "ci",
    });
    await exportRecords(exporter, [record({ "exception.message": "boom" })]);
    expect(PostHogMock).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ host: "https://eu.i.posthog.com" }),
    );
  });

  it("shuts the client down (and tolerates never having created one)", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    await expect(exporter.shutdown()).resolves.toBeUndefined();
    expect(shutdownMock).not.toHaveBeenCalled();

    await exportRecords(exporter, [record({ "exception.message": "boom" })]);
    await exporter.shutdown();
    expect(shutdownMock).toHaveBeenCalledOnce();
  });
});
