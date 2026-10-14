import { describe, expect, it } from "vitest";

import { logger, logInfo } from "./logging";

describe("logging", () => {
  it("exposes the f3-db logger and the log helpers", () => {
    expect(typeof logInfo).toBe("function");
    expect(logger).toBeDefined();
  });
});
