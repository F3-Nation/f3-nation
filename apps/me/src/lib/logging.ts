type LogLevel = "INFO" | "WARNING" | "ERROR";

type LogContext = Record<string, unknown>;

function emit(level: LogLevel, event: string, context: LogContext = {}) {
  const payload = {
    severity: level,
    event,
    service: "f3-me",
    ...context,
  };

  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
}

export function logInfo(event: string, context: LogContext = {}) {
  emit("INFO", event, context);
}

export function logWarn(event: string, context: LogContext = {}) {
  emit("WARNING", event, context);
}

export function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      errorStack: err.stack,
      errorCause:
        typeof err.cause === "string"
          ? err.cause
          : err.cause
            ? JSON.stringify(err.cause)
            : undefined,
    };
  }

  return {
    errorValue: typeof err === "string" ? err : JSON.stringify(err),
  };
}

export function logError(
  event: string,
  context: LogContext = {},
  err?: unknown,
) {
  emit("ERROR", event, {
    ...context,
    ...(err !== undefined ? serializeError(err) : {}),
  });
}
