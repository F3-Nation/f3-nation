import { createRequire } from "node:module";
import type { Logger, LoggerOptions } from "pino";
import pino from "pino";
import type PinoPretty from "pino-pretty";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Pino emits a numeric `level`; Google Cloud Logging keys off a string
 * `severity` field. This mapping is the entirety of the GCP-specific config —
 * it only matters in production (Cloud Run), so we skip it in development to let
 * pino-pretty colorize by pino's native level instead.
 */
const levelToSeverity: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

export type LogContext = Record<string, unknown>;

/**
 * Optional process-global error sink. Apps with Sentry register a reporter here
 * at startup (see each app's instrumentation) so that everything logged via
 * `logError` anywhere in the process still reaches Sentry — replacing the
 * `console.error` path that `captureConsoleIntegration` used to catch before
 * logs moved to pino/stdout.
 *
 * The reporter receives the full payload — the `event` name, structured `ctx`,
 * and the optional `err` — so it can preserve triage context and report
 * error-level logs that carry no `Error` object (e.g. config/validation
 * failures) just like `console.error` did.
 */
let errorReporter:
  ((event: string, ctx: LogContext, err?: unknown) => void) | undefined;

export function setErrorReporter(
  fn: (event: string, ctx: LogContext, err?: unknown) => void,
) {
  errorReporter = fn;
}

export interface AppLogger {
  /**
   * Raw pino instance. Reach for this only when the helpers can't express what
   * you need — e.g. request-scoped children (`logger.child({ requestId })`).
   * For ordinary event logging prefer the `log*` helpers below: they take the
   * `event` identifier first (pino's native methods take the context object
   * first), so mixing the two styles is an easy footgun.
   */
  logger: Logger;
  logTrace: (event: string, ctx?: LogContext) => void;
  logDebug: (event: string, ctx?: LogContext) => void;
  logInfo: (event: string, ctx?: LogContext) => void;
  logWarn: (event: string, ctx?: LogContext) => void;
  logError: (event: string, ctx?: LogContext, err?: unknown) => void;
  logFatal: (event: string, ctx?: LogContext, err?: unknown) => void;
}

export function createLogger(
  service: string,
  options?: { level?: string },
): AppLogger {
  const level = options?.level ?? process.env.LOG_LEVEL ?? "info";

  const baseOptions: LoggerOptions = {
    level,
    base: { service },
    // Keep the existing `event` field name (the custom logger's dot-namespaced
    // identifier) as pino's message key rather than the default `msg`.
    messageKey: "event",
    serializers: { err: pino.stdSerializers.err },
  };

  let logger: Logger;
  if (isProduction) {
    logger = pino({
      ...baseOptions,
      formatters: {
        level: (label) => ({ severity: levelToSeverity[label] ?? "DEFAULT" }),
      },
    });
  } else {
    // Lazy-require so pino-pretty / thread-stream never load in production.
    const require = createRequire(import.meta.url);
    const pretty = require("pino-pretty") as typeof PinoPretty;
    logger = pino(
      baseOptions,
      pretty({
        colorize: true,
        messageKey: "event",
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
      }),
    );
  }

  // error and fatal share the same shape: attach the optional `err` and fan
  // out to the process-global error sink (Sentry) so nothing is lost.
  const reportable =
    (level: "error" | "fatal") =>
    (event: string, ctx: LogContext = {}, err?: unknown) => {
      logger[level]({ ...ctx, ...(err !== undefined ? { err } : {}) }, event);
      // Never let a failing reporter (e.g. the Sentry bridge) throw out of a
      // log call and break request flow. Report the failure via raw pino so we
      // don't re-enter the reporter.
      if (errorReporter) {
        try {
          errorReporter(event, ctx, err);
        } catch (reporterErr) {
          logger.error(
            { err: reporterErr, event },
            "logger.error_reporter_failed",
          );
        }
      }
    };

  return {
    logger,
    logTrace: (event, ctx = {}) => logger.trace(ctx, event),
    logDebug: (event, ctx = {}) => logger.debug(ctx, event),
    logInfo: (event, ctx = {}) => logger.info(ctx, event),
    logWarn: (event, ctx = {}) => logger.warn(ctx, event),
    logError: reportable("error"),
    logFatal: reportable("fatal"),
  };
}
