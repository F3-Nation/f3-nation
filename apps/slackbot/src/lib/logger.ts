/**
 * Structured logging utility for the Slack bot.
 *
 * Uses console for local development and can be extended
 * for GCP Cloud Logging in production.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

const isLocalDevelopment =
  process.env.LOCAL_DEVELOPMENT?.toLowerCase() === "true";

function formatLog(entry: LogEntry): string {
  if (isLocalDevelopment) {
    const prefix = {
      debug: "🔍",
      info: "ℹ️ ",
      warn: "⚠️ ",
      error: "❌",
    }[entry.level];

    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
    return `${prefix} [${entry.timestamp}] ${entry.message}${dataStr}`;
  }

  // Structured JSON for production (GCP Cloud Logging compatible)
  return JSON.stringify({
    severity: entry.level.toUpperCase(),
    message: entry.message,
    timestamp: entry.timestamp,
    ...(entry.data ? { data: entry.data } : {}),
  });
}

function createLogEntry(
  level: LogLevel,
  message: string,
  data?: unknown,
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    data,
  };
}

export const logger = {
  debug(message: string, data?: unknown): void {
    if (isLocalDevelopment) {
      console.debug(formatLog(createLogEntry("debug", message, data)));
    }
  },

  info(message: string, data?: unknown): void {
    console.info(formatLog(createLogEntry("info", message, data)));
  },

  warn(message: string, data?: unknown): void {
    console.warn(formatLog(createLogEntry("warn", message, data)));
  },

  error(message: string, error?: unknown): void {
    const data =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error;
    console.error(formatLog(createLogEntry("error", message, data)));
  },
};
