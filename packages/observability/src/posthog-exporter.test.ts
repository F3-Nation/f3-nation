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

// Records reaching a real exporter always carry the LoggerProvider's Resource
// (that is where service.name lives — see registerObservability), so the
// helper models one by default. Pass `null` to model a resource-less record
// from a foreign emitter.
function record(
  attributes: Record<string, unknown>,
  resourceAttributes: Record<string, unknown> | null = {
    "service.name": "api",
  },
): ReadableLogRecord {
  return {
    attributes,
    resource:
      resourceAttributes === null
        ? undefined
        : { attributes: resourceAttributes },
  } as unknown as ReadableLogRecord;
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

  it("tolerates a foreign emitter using non-string exception attributes", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    await exportRecords(exporter, [
      record({ "exception.message": { weird: true }, "exception.type": 42 }),
    ]);
    const [reported] = captureExceptionImmediateMock.mock.calls[0] as [Error];
    expect(reported.message).toBe('{"weird":true}');
    // Non-string type is ignored — the Error keeps its default name.
    expect(reported.name).toBe("Error");
  });

  it("keeps the rebuilt Error's own stack when the record carries none", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    await exportRecords(exporter, [record({ "exception.message": "boom" })]);
    const [reported] = captureExceptionImmediateMock.mock.calls[0] as [Error];
    expect(reported.stack).toBeDefined();
  });

  it("carries the resource's service.name onto the event", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    await exportRecords(exporter, [
      record(
        { "exception.message": "boom", userId: "u1" },
        {
          "service.name": "map",
        },
      ),
    ]);
    expect(captureExceptionImmediateMock).toHaveBeenCalledWith(
      expect.any(Error),
      undefined,
      { userId: "u1", "service.name": "map", environment: "ci" },
    );
  });

  it("cannot be spoofed by a record attribute named service.name", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    await exportRecords(exporter, [
      record(
        { "exception.message": "boom", "service.name": "not-me" },
        {
          "service.name": "api",
        },
      ),
    ]);
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties["service.name"]).toBe("api");
  });

  it("omits service.name entirely for a resource-less record", async () => {
    const exporter = new PostHogExceptionExporter({
      apiKey: "test-key",
      environment: "ci",
    });
    await exportRecords(exporter, [
      record({ "exception.message": "boom" }, null),
    ]);
    const [, , properties] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties).not.toHaveProperty("service.name");
    expect(properties.environment).toBe("ci");
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
