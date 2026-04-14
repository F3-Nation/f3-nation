/**
 * Tiny structured JSON logger for the redirect runtime.
 *
 * The Cloud Run runner ships logs to Google Cloud Logging via stdout;
 * Cloud Logging auto-promotes a top-level `severity` field and treats
 * the rest of the object as `jsonPayload`. We deliberately keep this
 * much simpler than `apps/reconciler/src/logging.ts` — the runtime
 * doesn't emit any CRITICAL log-based alert metrics (those are the
 * reconciler's job). The runtime only needs INFO/WARN/ERROR on the
 * cache refresh path and DEBUG on the redirect hot path.
 */

export type LogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface CreateLoggerOptions {
  /** Minimum severity to emit. Defaults to `INFO`. */
  minLevel?: LogSeverity;
  /** Override the writer — tests inject a collector. */
  emit?: (line: string) => void;
}

const SEVERITY_RANK: Record<LogSeverity, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};

function defaultEmit(line: string): void {
  // Cloud Logging structures stdout JSON automatically — writing with
  // console.log is the idiomatic path; no log writer library needed.
  console.log(line);
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? "INFO";
  const emit = options.emit ?? defaultEmit;
  const threshold = SEVERITY_RANK[minLevel];

  function write(
    severity: LogSeverity,
    message: string,
    fields: LogFields | undefined,
  ): void {
    if (SEVERITY_RANK[severity] < threshold) return;
    const entry: Record<string, unknown> = {
      severity,
      message,
      service: "redirect-runtime",
      ...fields,
    };
    emit(JSON.stringify(entry));
  }

  return {
    debug(message, fields) {
      write("DEBUG", message, fields);
    },
    info(message, fields) {
      write("INFO", message, fields);
    },
    warn(message, fields) {
      write("WARNING", message, fields);
    },
    error(message, fields) {
      write("ERROR", message, fields);
    },
  };
}

// Module-level default logger for places that don't thread a context.
// In tests, instantiate your own via `createLogger({ emit })`.
export const logger: Logger = createLogger({
  minLevel:
    process.env.RUNTIME_LOG_LEVEL === "DEBUG"
      ? "DEBUG"
      : process.env.NODE_ENV === "test"
        ? "ERROR"
        : "INFO",
});
