import type { Instrumentation } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "~/instrumentation";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("~/lib/logging", () => ({ logError }));

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;

function callHook(err: unknown) {
  return onRequestError(
    err,
    {
      method: "GET",
      path: "/users/42?token=secret",
    } as Parameters<Instrumentation.onRequestError>[1],
    {
      routerKind: "App Router",
      routePath: "/users/[id]",
      routeType: "render",
    } as Parameters<Instrumentation.onRequestError>[2],
  );
}

describe("auth onRequestError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
  });

  it("logs the digest and the route template, never the resolved path", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const err = Object.assign(new Error("boom"), { digest: "d1" });
    await callHook(err);
    expect(logError).toHaveBeenCalledWith(
      "auth.request.unhandled_error",
      {
        digest: "d1",
        route: "/users/[id]",
        routerKind: "App Router",
        method: "GET",
      },
      err,
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret");
  });

  it("logs errors without a digest", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await callHook("not an error");
    expect(logError).toHaveBeenCalledWith(
      "auth.request.unhandled_error",
      expect.objectContaining({ digest: undefined }),
      "not an error",
    );
  });

  it("does nothing outside the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await callHook(new Error("boom"));
    expect(logError).not.toHaveBeenCalled();
  });
});
