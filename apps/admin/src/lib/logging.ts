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
      service: "f3-admin",
      ...context,
    });
  } catch {
    line = JSON.stringify({
      severity: level,
      event,
      service: "f3-admin",
      serializeError: "payload had circular references",
    });
  }
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
}

function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      errorStack: err.stack,
      errorCause:
        err.cause instanceof Error
          ? safeStringify({
              name: err.cause.name,
              message: err.cause.message,
              stack: err.cause.stack,
            })
          : typeof err.cause === "string"
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
