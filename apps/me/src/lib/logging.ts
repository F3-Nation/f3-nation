type LogLevel = "INFO" | "WARNING" | "ERROR";

type LogContext = Record<string, unknown>;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[Circular]";
  }
}

function emit(level: LogLevel, event: string, context: LogContext = {}) {
  let line: string;
  try {
    line = JSON.stringify({
      severity: level,
      event,
      service: "f3-me",
      ...context,
    });
  } catch {
    line = JSON.stringify({
      severity: level,
      event,
      service: "f3-me",
      serializeError: "payload had circular references",
    });
  }
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

function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      errorStack: err.stack,
      errorCause:
        typeof err.cause === "string"
          ? err.cause
          : err.cause
            ? safeStringify(err.cause)
            : undefined,
    };
  }

  return {
    errorValue: typeof err === "string" ? err : safeStringify(err),
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
