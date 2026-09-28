/**
 * `instrumentation-client.ts` runs its work at module scope, so each case here
 * re-imports it under `vi.resetModules()` with the env/hostname it wants.
 *
 * Two things are pinned: the privacy posture (session recording off unless
 * explicitly enabled; masking on in both autocapture and replay), and the
 * `environment` super-property — without it, prod and staging browser events
 * are byte-identical in PostHog, since one build is promoted unchanged across
 * environments and a build-time channel var therefore can't tell them apart.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { init, register } = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: { init, register } }));

async function loadWith(
  env: Record<string, string | undefined>,
  hostname = "map.f3nation.com",
) {
  vi.resetModules();
  vi.doMock("~/env", () => ({ env }));
  Object.defineProperty(window, "location", {
    value: { hostname },
    writable: true,
  });
  await import("~/instrumentation-client");
}

describe("instrumentation-client", () => {
  beforeEach(() => {
    init.mockClear();
    register.mockClear();
  });

  it("does nothing at all when no PostHog key is configured", async () => {
    await loadWith({ NEXT_PUBLIC_POSTHOG_KEY: undefined });

    expect(init).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("initializes with masking on and session recording off by default", async () => {
    await loadWith({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });

    expect(init).toHaveBeenCalledTimes(1);
    const [key, options] = init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(key).toBe("phc_test");
    expect(options).toMatchObject({
      capture_exceptions: true,
      mask_all_text: true,
      disable_session_recording: true,
      session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    });
  });

  it("enables session recording only on an explicit 'true' flag", async () => {
    await loadWith({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      NEXT_PUBLIC_POSTHOG_SESSION_RECORDING: "true",
    });

    const [, options] = init.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.disable_session_recording).toBe(false);
    // Masking must survive the opt-in — the update-request form carries names
    // and emails.
    expect(options.session_recording).toEqual({
      maskAllInputs: true,
      maskTextSelector: "*",
    });
  });

  it("leaves recording disabled for any value other than 'true'", async () => {
    await loadWith({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      NEXT_PUBLIC_POSTHOG_SESSION_RECORDING: "1",
    });

    const [, options] = init.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.disable_session_recording).toBe(true);
  });

  it.each([
    ["map.f3nation.com", "prod"],
    ["staging.map.f3nation.com", "staging"],
    ["localhost", "local"],
    ["127.0.0.1", "local"],
    ["f3-map-pr-123-abc.a.run.app", "dev"],
  ])("tags %s as environment=%s", async (hostname, expected) => {
    await loadWith({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" }, hostname);

    expect(register).toHaveBeenCalledWith({ environment: expected });
  });
});
