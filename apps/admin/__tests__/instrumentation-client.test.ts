/**
 * The app's only job here is to hand its build-time key and its name to the
 * shared reporter; the reporter's config (errors only, no analytics) is pinned
 * in packages/observability/src/browser.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

const { initErrorReporting } = vi.hoisted(() => ({
  initErrorReporting: vi.fn(),
}));

vi.mock("@acme/observability/browser", () => ({ initErrorReporting }));
vi.mock("~/env", () => ({ env: { NEXT_PUBLIC_POSTHOG_KEY: "phc_test" } }));

describe("instrumentation-client", () => {
  it("starts error reporting with the build-time key, tagged as admin", async () => {
    await import("~/instrumentation-client");

    expect(initErrorReporting).toHaveBeenCalledWith({
      key: "phc_test",
      app: "admin",
    });
  });
});
