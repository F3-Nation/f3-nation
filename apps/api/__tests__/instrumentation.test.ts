/**
 * The Node-runtime guard and the `onRequestError` hook, pinned.
 *
 * The load-bearing assertion is that `onRequestError` reports
 * `context.routePath` — the STATIC route template — and never the resolved
 * request path, which for this app routinely carries record ids and tokens.
 */

import type { Instrumentation } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerObservability, registerLoggerErrorReporter, captureException } =
  vi.hoisted(() => ({
    registerObservability: vi.fn(),
    registerLoggerErrorReporter: vi.fn(),
    captureException: vi.fn(() => Promise.resolve()),
  }));

vi.mock("@acme/observability", () => ({
  registerObservability,
  registerLoggerErrorReporter,
  captureException,
}));

vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_CHANNEL: "prod", NEXT_PUBLIC_POSTHOG_KEY: "phc_test" },
}));

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;

function requestErrorArgs(routePath: string) {
  return [
    new Error("boom"),
    {
      method: "GET",
      path: "/v1/request/id/42?token=secret",
    } as Parameters<Instrumentation.onRequestError>[1],
    {
      routerKind: "App Router",
      routePath,
      routeType: "route",
    } as Parameters<Instrumentation.onRequestError>[2],
  ] as const;
}

describe("api instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
  });

  it("registers observability and the logger bridge on the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("~/instrumentation");

    await register();

    expect(registerObservability).toHaveBeenCalledWith({
      serviceName: "api",
      environment: "prod",
      posthog: { apiKey: "phc_test" },
    });
    expect(registerLoggerErrorReporter).toHaveBeenCalledTimes(1);
  });

  it("registers nothing off the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("~/instrumentation");

    await register();

    expect(registerObservability).not.toHaveBeenCalled();
    expect(registerLoggerErrorReporter).not.toHaveBeenCalled();
  });

  it("reports the static route template, never the resolved path", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { onRequestError } = await import("~/instrumentation");

    await onRequestError(...requestErrorArgs("/v1/request/id/[id]"));

    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, attrs] = captureException.mock.calls[0] as unknown as [
      Error,
      Record<string, unknown>,
    ];
    expect(err).toBeInstanceOf(Error);
    expect(attrs).toEqual({
      route: "/v1/request/id/[id]",
      routerKind: "App Router",
      method: "GET",
    });
    // The resolved path carried both a record id and a token.
    expect(JSON.stringify(attrs)).not.toContain("secret");
    expect(JSON.stringify(attrs)).not.toContain("/id/42");
  });

  it("logs a drop rather than silently losing edge-runtime errors", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { onRequestError } = await import("~/instrumentation");

    await onRequestError(...requestErrorArgs("/v1/request/id/[id]"));

    expect(captureException).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "instrumentation.request_error_uncaptured",
      { runtime: "edge", route: "/v1/request/id/[id]" },
    );
    consoleError.mockRestore();
  });
});
