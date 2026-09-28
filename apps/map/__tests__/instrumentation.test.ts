/**
 * The Node-runtime guard and the `onRequestError` hook, pinned.
 *
 * The load-bearing assertion is that `onRequestError` reports
 * `context.routePath` — the STATIC route template — and never the resolved
 * request path, which can carry ids, tokens, query strings, or PII.
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
  env: { F3_CHANNEL: "prod", NEXT_PUBLIC_POSTHOG_KEY: "phc_test" },
}));

// register() imports this for its side effect only. It must be mocked at the
// RELATIVE specifier the source actually uses — the `~/orpc/client.server`
// alias in vitest.config.ts doesn't intercept `./orpc/client.server`, and the
// real module pulls in @acme/db, which fails env validation under test.
vi.mock("../src/orpc/client.server", () => ({}));

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;

function requestErrorArgs(routePath: string) {
  return [
    new Error("boom"),
    {
      method: "GET",
      path: `${routePath}?token=secret`,
    } as Parameters<Instrumentation.onRequestError>[1],
    {
      routerKind: "App Router",
      routePath,
      routeType: "render",
    } as Parameters<Instrumentation.onRequestError>[2],
  ] as const;
}

describe("map instrumentation", () => {
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
      serviceName: "map",
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

    await onRequestError(...requestErrorArgs("/[locale]/map"));

    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, attrs] = captureException.mock.calls[0] as unknown as [
      Error,
      Record<string, unknown>,
    ];
    expect(err).toBeInstanceOf(Error);
    expect(attrs).toEqual({
      route: "/[locale]/map",
      routerKind: "App Router",
      method: "GET",
    });
    // The resolved path carried a token; nothing reported may contain it.
    expect(JSON.stringify(attrs)).not.toContain("secret");
  });

  it("logs a drop rather than silently losing edge-runtime errors", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { onRequestError } = await import("~/instrumentation");

    await onRequestError(...requestErrorArgs("/[locale]/map"));

    expect(captureException).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "instrumentation.request_error_uncaptured",
      { runtime: "edge", route: "/[locale]/map" },
    );
    consoleError.mockRestore();
  });
});
