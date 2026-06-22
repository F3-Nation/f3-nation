import { createLogger } from "@acme/logger";

export const {
  logTrace,
  logDebug,
  logInfo,
  logWarn,
  logError,
  logFatal,
  logger,
} = createLogger("f3-admin");
