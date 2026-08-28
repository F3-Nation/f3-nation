// Server-side observability, OTel-first. App code talks ONLY to the
// OpenTelemetry API surface exposed here (captureException + the logger
// bridge); concrete backends are adapters wired up in registerObservability.
// Today that is a single PostHog exception exporter (see posthog-exporter.ts);
// tomorrow it can be an OTLP collector, Cloud Trace, or the next tool —
// without touching app code.
//
// Node.js runtime only: the PostHog adapter needs Node APIs, so apps must
// import this module behind a `process.env.NEXT_RUNTIME === "nodejs"` check
// (see each app's instrumentation.ts).

import type { LogContext } from "@acme/logger";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import {
  ATTR_EXCEPTION_MESSAGE,
  ATTR_EXCEPTION_STACKTRACE,
  ATTR_EXCEPTION_TYPE,
  ATTR_SERVICE_NAME,
} from "@opentelemetry/semantic-conventions";

import { setErrorReporter } from "@acme/logger";

import { ImmediateLogRecordProcessor } from "./immediate-processor";
import { PostHogExceptionExporter } from "./posthog-exporter";

export interface ObservabilityConfig {
  /** OTel `service.name` resource attribute, e.g. "api" or "map". */
  serviceName: string;
  /** Deployment channel (e.g. "prod") — stamped on every exception event. */
  environment: string;
  /**
   * PostHog error-tracking adapter. Omit the key (previews without secrets,
   * local dev) and registration still succeeds — every capture below is a
   * silent no-op without a configured exporter.
   */
  posthog?: { apiKey?: string; host?: string };
}

let provider: LoggerProvider | undefined;

/**
 * Initialize the OTel logs pipeline for this process. Idempotent — Next.js
 * can evaluate instrumentation more than once (dev HMR), and only the first
 * call wins.
 */
export function registerObservability(config: ObservabilityConfig): void {
  if (provider) return;

  const processors = [];
  if (config.posthog?.apiKey) {
    // Immediate (not batching) processor: each record is handed to the
    // exporter as it is emitted and the in-flight send is tracked, so
    // captureException's forceFlush awaits the actual HTTP send — a queued
    // batch could be lost when a scale-to-zero Cloud Run instance is reaped.
    // (Not SimpleLogRecordProcessor — see immediate-processor.ts for why its
    // forceFlush doesn't provide this guarantee.)
    processors.push(
      new ImmediateLogRecordProcessor(
        new PostHogExceptionExporter({
          apiKey: config.posthog.apiKey,
          host: config.posthog.host,
          environment: config.environment,
        }),
      ),
    );
  }

  provider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      "deployment.environment.name": config.environment,
    }),
    processors,
  });
  // Expose the provider globally for any future OTel-aware library, but note
  // the capture path below deliberately uses our own `provider` reference:
  // the OTel global can only be set once per process, and depending on it
  // would silently no-op if something else (a future NodeSDK/tracing setup)
  // claimed it first.
  logs.setGlobalLoggerProvider(provider);
}

/**
 * Capture a server-side exception through the OTel logs pipeline, awaiting
 * delivery (Cloud Run scale-to-zero: a fire-and-forget report can be lost
 * when the instance is reaped). Non-`Error` values are wrapped so the error
 * tracker always gets a real stack. Never throws and never rejects.
 */
export async function captureException(
  err: unknown,
  attributes?: LogContext,
): Promise<void> {
  // The whole body is inside this try, not just the flush: a synchronous
  // throw from String(err) (a non-Error value with a throwing toString/
  // Symbol.toPrimitive) would otherwise become a rejected Promise, and the
  // logger bridge below calls this with `void` — an unhandled rejection
  // would crash the process (Node terminates on one by default since v15).
  try {
    if (!provider) return;
    const error = err instanceof Error ? err : new Error(safeStringify(err));
    provider.getLogger("@acme/observability").emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: error.message,
      // Exception attrs spread AFTER caller attributes: callers must not be
      // able to spoof exception.type/message/stacktrace.
      attributes: {
        ...toLogAttributes(attributes),
        [ATTR_EXCEPTION_TYPE]: error.name,
        [ATTR_EXCEPTION_MESSAGE]: error.message,
        ...(error.stack ? { [ATTR_EXCEPTION_STACKTRACE]: error.stack } : {}),
      },
    });
    await provider.forceFlush();
  } catch (reportErr) {
    // Never propagate — but always leave a trace so a pipeline failure
    // doesn't look identical to "no errors occurred." console.error, not
    // logError: this function IS the logger's errorReporter target, so
    // logError here would re-enter it.
    console.error("observability.capture_exception_failed", reportErr);
  }
}

/**
 * Bridge @acme/logger's `logError`/`logFatal` into the OTel exception
 * pipeline so structured error logs (pino → stdout) still reach an alertable
 * error tracker. Keeps the event name + context so events stay triageable,
 * and reports err-less error logs (config/validation failures) as synthetic
 * errors named after the event.
 */
export function registerLoggerErrorReporter(): void {
  setErrorReporter((event: string, ctx: LogContext, err?: unknown) => {
    // logError/logFatal are synchronous, so this bridge can't await; fire and
    // forget. captureException swallows its own failures, so there is no
    // rejection to handle here.
    // ctx spread BEFORE event: a ctx key named "event" must not be able to
    // overwrite the canonical event identifier used for triage.
    void captureException(err ?? new Error(event), {
      ...ctx,
      event,
    });
  });
}

/**
 * OTel log attributes must be JSON-shaped values; @acme/logger's LogContext
 * is Record<string, unknown>. Primitives pass through; anything else is
 * stringified (safely) rather than dropped, so triage context survives.
 */
function toLogAttributes(
  ctx: LogContext | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!ctx) return out;
  for (const [key, value] of Object.entries(ctx)) {
    if (value === undefined || value === null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    } else {
      out[key] = safeJsonStringify(value);
    }
  }
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unstringifiable error value]";
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? safeStringify(value);
  } catch {
    return safeStringify(value);
  }
}
