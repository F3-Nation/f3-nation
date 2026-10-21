/**
 * The app's only job here is to hand its build-time key (read straight from process.env, never ~/env) and its
 * name to the shared reporter; the reporter's config (errors only, no
 * analytics) is pinned in packages/observability/src/browser.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initErrorReporting } = vi.hoisted(() => ({
  initErrorReporting: vi.fn(),
}));

vi.mock("@acme/observability/browser", () => ({ initErrorReporting }));

describe("instrumentation-client", () => {
  beforeEach(() => {
    vi.resetModules();
    initErrorReporting.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts error reporting with the build-time key, tagged as auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    await import("~/instrumentation-client");

    expect(initErrorReporting).toHaveBeenCalledWith({
      key: "phc_test",
      app: "auth",
    });
  });

  it("still calls the reporter in a keyless build, which then does nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", undefined);
    await import("~/instrumentation-client");

    expect(initErrorReporting).toHaveBeenCalledWith({
      key: undefined,
      app: "auth",
    });
  });
});
