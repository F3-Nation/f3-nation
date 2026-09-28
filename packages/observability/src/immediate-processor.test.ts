import type {
  LogRecordExporter,
  ReadableLogRecord,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import { ExportResultCode } from "@opentelemetry/core";
import { describe, expect, it, vi } from "vitest";

import { ImmediateLogRecordProcessor } from "./immediate-processor";

/** Exporter whose export completion is controlled by the test. */
function deferredExporter() {
  const callbacks: ((code: ExportResultCode) => void)[] = [];
  const shutdownMock = vi.fn(() => Promise.resolve());
  const exporter: LogRecordExporter = {
    export: (_records: ReadableLogRecord[], resultCallback) => {
      callbacks.push((code) => resultCallback({ code }));
    },
    shutdown: shutdownMock,
    forceFlush: () => Promise.resolve(),
  };
  return { exporter, callbacks, shutdownMock };
}

const record = {} as SdkLogRecord;

describe("ImmediateLogRecordProcessor", () => {
  it("forceFlush resolves only after in-flight exports complete", async () => {
    // This is the guarantee SimpleLogRecordProcessor does NOT provide (its
    // forceFlush only awaits exports blocked on async resource attributes) —
    // and the reason this processor exists. If this test fails, a Cloud Run
    // instance reaped after forceFlush could lose the error report.
    const { exporter, callbacks } = deferredExporter();
    const processor = new ImmediateLogRecordProcessor(exporter);

    processor.onEmit(record);
    let flushed = false;
    const flush = processor.forceFlush().then(() => {
      flushed = true;
    });

    // Give the flush promise every chance to (incorrectly) resolve early.
    await new Promise((r) => setImmediate(r));
    expect(flushed).toBe(false);

    callbacks[0]?.(ExportResultCode.SUCCESS);
    await flush;
    expect(flushed).toBe(true);
  });

  it("forceFlush awaits every pending export, not just the latest", async () => {
    const { exporter, callbacks } = deferredExporter();
    const processor = new ImmediateLogRecordProcessor(exporter);

    processor.onEmit(record);
    processor.onEmit(record);
    let flushed = false;
    const flush = processor.forceFlush().then(() => {
      flushed = true;
    });

    callbacks[0]?.(ExportResultCode.SUCCESS);
    await new Promise((r) => setImmediate(r));
    expect(flushed).toBe(false);

    callbacks[1]?.(ExportResultCode.SUCCESS);
    await flush;
    expect(flushed).toBe(true);
  });

  it("settled exports are dropped from the pending set", async () => {
    const { exporter, callbacks } = deferredExporter();
    const processor = new ImmediateLogRecordProcessor(exporter);

    processor.onEmit(record);
    callbacks[0]?.(ExportResultCode.SUCCESS);
    await processor.forceFlush();

    // A later flush with nothing in flight resolves immediately.
    await expect(processor.forceFlush()).resolves.toBeUndefined();
  });

  it("shutdown drains in-flight exports before shutting the exporter down", async () => {
    const { exporter, callbacks, shutdownMock } = deferredExporter();
    const processor = new ImmediateLogRecordProcessor(exporter);

    processor.onEmit(record);
    let shutdownDone = false;
    const shutdown = processor.shutdown().then(() => {
      shutdownDone = true;
    });

    await new Promise((r) => setImmediate(r));
    expect(shutdownDone).toBe(false);
    expect(shutdownMock).not.toHaveBeenCalled();

    callbacks[0]?.(ExportResultCode.SUCCESS);
    await shutdown;
    expect(shutdownMock).toHaveBeenCalledOnce();
  });
});
