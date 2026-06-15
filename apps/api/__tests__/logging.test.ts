import { describe, expect, it } from "vitest";

import * as logging from "../src/lib/logging";

// Guards the re-export surface of the app's logging module: every @acme/logger
// helper must be forwarded (a missing one — e.g. logDebug — silently resolves to
// `any` at call sites and trips the no-restricted-syntax / type checks).
describe("lib/logging re-exports", () => {
  it("forwards every log level helper", () => {
    for (const name of [
      "logTrace",
      "logDebug",
      "logInfo",
      "logWarn",
      "logError",
      "logFatal",
    ] as const) {
      expect(typeof logging[name]).toBe("function");
    }
  });

  it("exposes the raw pino instance for child loggers", () => {
    expect(logging.logger).toBeDefined();
    expect(typeof logging.logger.child).toBe("function");
  });
});
