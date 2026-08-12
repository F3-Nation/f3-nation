// PostHog is an *adapter* behind the OpenTelemetry logs pipeline: app code
// only ever talks to the OTel API (via `captureException` in index.ts), and
// this exporter translates exception log records into PostHog `$exception`
// events. It is the only file in the monorepo that imports posthog-node —
// swapping error trackers later means replacing this exporter, not touching
// app code. https://posthog.com/docs/error-tracking/installation

import type { ExportResult } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { ExportResultCode } from "@opentelemetry/core";
import {
  ATTR_EXCEPTION_MESSAGE,
  ATTR_EXCEPTION_STACKTRACE,
  ATTR_EXCEPTION_TYPE,
} from "@opentelemetry/semantic-conventions";
import { PostHog } from "posthog-node";

export interface PostHogExceptionExporterOptions {
  apiKey: string;
  host?: string;
  /**
   * Deployment channel (e.g. "prod") stamped onto every event as the
   * canonical `environment` property — record attributes can never
   * overwrite it.
   */
  environment: string;
}

export class PostHogExceptionExporter implements LogRecordExporter {
  private client: PostHog | undefined;

  constructor(private readonly options: PostHogExceptionExporterOptions) {}

  private getClient(): PostHog {
    // Error volume is tiny and Cloud Run scales to zero between requests.
    // flushAt/flushInterval only govern posthog-node's batched capture()
    // path — the only method this exporter calls is captureExceptionImmediate
    // below, which sends over HTTP directly and never consults these two
    // options. The actual "nothing is lost when an instance is reaped"
    // guarantee comes entirely from using captureExceptionImmediate; these
    // are left as a defensive fallback in case a future edit adds a
    // non-immediate capture() call here.
    this.client ??= new PostHog(this.options.apiKey, {
      host: this.options.host ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
      // The export is awaited from request-error instrumentation (via
      // forceFlush) — a PostHog outage or slow network must not degrade
      // error handling. The SDK's defaults (10s timeout, 3 retries) could
      // otherwise block for 30+s; bound it tightly and skip retries (this is
      // a fire-once error report, not data that must land — a failure is
      // already logged by the catch in send()).
      requestTimeout: 3000,
      fetchRetryCount: 0,
    });
    return this.client;
  }

  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    // Only records carrying OTel exception semantics become PostHog
    // $exception events; anything else (a future processor emitting plain
    // logs) is deliberately skipped — PostHog is an error tracker here, not
    // a log sink (stdout/GCP Logging is, see @acme/logger).
    const sends = records
      .filter((r) => r.attributes[ATTR_EXCEPTION_MESSAGE] !== undefined)
      .map((r) => this.send(r));
    // send() never rejects (it reports and swallows its own failures), so
    // the pipeline always sees success — an error-tracker outage must never
    // bubble back into request handling as an export failure.
    void Promise.all(sends).then(() => {
      resultCallback({ code: ExportResultCode.SUCCESS });
    });
  }

  private async send(record: ReadableLogRecord): Promise<void> {
    try {
      const {
        [ATTR_EXCEPTION_TYPE]: type,
        [ATTR_EXCEPTION_MESSAGE]: message,
        [ATTR_EXCEPTION_STACKTRACE]: stacktrace,
        ...rest
      } = record.attributes;

      // Rebuild a real Error so PostHog error tracking gets a stack to group
      // on. The stack is the ORIGINAL error's stack string (captured in
      // index.ts) — overwriting the fresh Error's own stack is the point.
      // message is always the string index.ts put there; the JSON.stringify
      // arm only guards against a foreign emitter using non-string exception
      // attributes.
      const error = new Error(
        typeof message === "string" ? message : JSON.stringify(message),
      );
      if (typeof type === "string" && type) error.name = type;
      if (typeof stacktrace === "string" && stacktrace)
        error.stack = stacktrace;

      // environment spread AFTER the record attributes: a caller-supplied
      // "environment" key must not be able to overwrite the canonical one.
      await this.getClient().captureExceptionImmediate(error, undefined, {
        ...rest,
        environment: this.options.environment,
      });
    } catch (reportErr) {
      // Never propagate — but always leave a trace so a PostHog outage (bad
      // key, network failure, rate limit, TLS error) doesn't look identical
      // to "no errors occurred." Deliberately console.error, not logError:
      // this exporter sits at the bottom of the logger's errorReporter
      // bridge, so logError here would re-enter it via
      // packages/logger/src/index.ts's reportable().
      console.error("posthog.capture_exception_failed", reportErr);
    }
  }

  forceFlush(): Promise<void> {
    // Every send is immediate (captureExceptionImmediate) and export() only
    // reports success once all sends have settled, so there is never a
    // buffered backlog to flush here — the processor's own pending-export
    // tracking is what forceFlush awaits.
    return Promise.resolve();
  }

  async shutdown(): Promise<void> {
    await this.client?.shutdown();
  }
}
