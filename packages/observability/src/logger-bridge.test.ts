import { createLogger, setErrorReporter } from "@acme/logger";
import { afterEach, expect, it, vi } from "vitest";

import {
  flushObservability,
  registerLoggerErrorReporter,
  registerObservability,
} from "./index";

const captureExceptionImmediateMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const PostHogMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: unknown) {
    Object.assign(this as object, {
      captureExceptionImmediate: captureExceptionImmediateMock,
      shutdown: vi.fn(),
    });
  }),
);

vi.mock("posthog-node", () => ({ PostHog: PostHogMock }));

afterEach(() => {
  setErrorReporter(() => undefined);
  vi.restoreAllMocks();
});

it("carries a sanitized audit SQLSTATE through the real logger bridge", async () => {
  registerObservability({
    serviceName: "audit-bridge-test",
    environment: "test",
    posthog: { apiKey: "test-key" },
  });
  registerLoggerErrorReporter();
  const instance = createLogger("audit-bridge-test");
  vi.spyOn(instance.logger, "error").mockImplementation(() => undefined);
  const error = new Error(
    "Failed query: insert into api_keys values ($1)\nparams: synthetic-secret",
    {
      cause: Object.assign(new Error("Audit history capture failed"), {
        code: "AH002",
        schema_name: "public",
        table_name: "api_keys",
      }),
    },
  );

  instance.logError("api.audit.failed", {}, error);
  await flushObservability();

  expect(captureExceptionImmediateMock).toHaveBeenCalledOnce();
  const [reported, , properties] = captureExceptionImmediateMock.mock
    .calls[0] as [Error, undefined, Record<string, unknown>];
  expect(reported.message).toBe("Audit history capture failed");
  expect(reported.cause).toBeUndefined();
  expect(reported.stack).not.toContain("synthetic-secret");
  expect(properties.root_cause_code).toBe("AH002");
  expect(JSON.stringify(properties)).not.toContain("synthetic-secret");
});
