// Why not SimpleLogRecordProcessor: its forceFlush() only awaits exports
// that were blocked on async resource attributes — the normal path fires
// `void doExport()` without tracking the promise (verified against
// @opentelemetry/sdk-logs 0.221's SimpleLogRecordProcessor). Our resource
// attributes are static, so `provider.forceFlush()` would resolve before the
// exporter's HTTP send completes, and a scale-to-zero Cloud Run instance
// reaped right after responding could lose the error report — the exact
// failure mode captureException's awaited flush exists to prevent.

import type { Context } from "@opentelemetry/api";
import type {
  LogRecordExporter,
  LogRecordProcessor,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";

/**
 * Exports each record as it is emitted (no batching — error volume is tiny)
 * and tracks every in-flight export so `forceFlush()` resolves only after
 * the exporter has finished sending. The exporter reports failures itself
 * (see PostHogExceptionExporter.send), so onEmit ignores the ExportResult.
 */
export class ImmediateLogRecordProcessor implements LogRecordProcessor {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly exporter: LogRecordExporter) {}

  onEmit(logRecord: SdkLogRecord, _context?: Context): void {
    const exportDone = new Promise<void>((resolve) => {
      this.exporter.export([logRecord], () => resolve());
    });
    this.pending.add(exportDone);
    void exportDone.finally(() => this.pending.delete(exportDone));
  }

  async forceFlush(): Promise<void> {
    await Promise.all(Array.from(this.pending));
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    await this.exporter.shutdown();
  }
}
