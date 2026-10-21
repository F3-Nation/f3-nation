/**
 * Pins the cost guarantee from #1223: the non-map apps report errors and
 * nothing else, so they can't eat into the map's analytics quota. Each case
 * re-imports the module under `vi.resetModules()` so its `enabled` flag starts
 * fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { init, register, captureException } = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: { init, register, captureException },
}));

import { environmentFromHostname, scrubUrls } from "./browser";

// Cleanup that runs even when an assertion fails partway through a test.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load() {
  vi.resetModules();
  return import("./browser");
}

describe("environmentFromHostname", () => {
  it.each([
    ["localhost", "local"],
    ["127.0.0.1", "local"],
    ["staging.admin.f3nation.com", "staging"],
    ["staging.me.f3nation.com", "staging"],
    ["admin.f3nation.com", "prod"],
    ["auth.f3nation.com", "prod"],
    ["f3nation.com", "prod"],
    ["f3-admin-pr-123-abc.a.run.app", "dev"],
    ["notf3nation.com", "dev"],
  ])("%s -> %s", (hostname, expected) => {
    expect(environmentFromHostname(hostname)).toBe(expected);
  });
});

describe("scrubUrls", () => {
  it("strips the query and fragment from every page URL property", () => {
    const scrubbed = scrubUrls({
      uuid: "u",
      event: "$exception",
      properties: {
        $current_url:
          "https://auth.f3nation.com/login/email/verify?email=a%40b.com&code=123456",
        $referrer: "https://auth.f3nation.com/register?email=a%40b.com#step",
        $initial_current_url: "https://auth.f3nation.com/?code=1",
        $pathname: "/login/email/verify",
        $exception_list: [],
      },
      $set_once: { $initial_referrer: "https://me.f3nation.com/x?code=9" },
    });

    expect(scrubbed?.properties).toMatchObject({
      $current_url: "https://auth.f3nation.com/login/email/verify",
      $referrer: "https://auth.f3nation.com/register",
      $initial_current_url: "https://auth.f3nation.com/",
      $pathname: "/login/email/verify",
    });
    expect(scrubbed?.$set_once).toEqual({
      $initial_referrer: "https://me.f3nation.com/x",
    });
  });

  it("leaves URLs without a query, non-string values and null events alone", () => {
    expect(
      scrubUrls({
        uuid: "u",
        event: "$exception",
        properties: {
          $current_url: "https://admin.f3nation.com/a",
          $referrer: 3,
        },
      })?.properties,
    ).toEqual({ $current_url: "https://admin.f3nation.com/a", $referrer: 3 });
    expect(scrubUrls(null)).toBeNull();
  });
});

describe("initErrorReporting", () => {
  beforeEach(() => {
    init.mockReset();
    register.mockReset();
    captureException.mockReset();
  });

  it("does nothing without a key", async () => {
    const browser = await load();
    browser.initErrorReporting({
      key: undefined,
      app: "admin",
      hostname: "admin.f3nation.com",
    });
    browser.captureException(new Error("boom"));

    expect(init).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures exceptions with every analytics feature off", async () => {
    const browser = await load();
    browser.initErrorReporting({
      key: "phc_test",
      app: "auth",
      hostname: "auth.f3nation.com",
    });

    expect(init).toHaveBeenCalledTimes(1);
    const [key, options] = init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(key).toBe("phc_test");
    expect(options).toMatchObject({
      capture_exceptions: true,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      rageclick: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      persistence: "memory",
    });
    // The hook it was given is the URL scrubber.
    const beforeSend = options.before_send as typeof scrubUrls;
    expect(
      beforeSend({
        uuid: "u",
        event: "$exception",
        properties: { $current_url: "https://auth.f3nation.com/v?code=1" },
      })?.properties.$current_url,
    ).toBe("https://auth.f3nation.com/v");
  });

  it("tags every event with the app and environment", async () => {
    const browser = await load();
    browser.initErrorReporting({
      key: "phc_test",
      app: "me",
      hostname: "staging.me.f3nation.com",
    });

    expect(register).toHaveBeenCalledWith({
      app: "me",
      environment: "staging",
    });
  });

  it("leaves reporting off, without throwing, when PostHog fails to init", async () => {
    const browser = await load();
    init.mockImplementationOnce(() => {
      throw new Error("bad config");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() =>
      browser.initErrorReporting({
        key: "phc_test",
        app: "auth",
        hostname: "auth.f3nation.com",
      }),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      "posthog.init_failed",
      expect.any(Error),
    );
    browser.captureException(new Error("boom"));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reads the hostname from the page when none is passed", async () => {
    vi.stubGlobal("window", { location: { hostname: "admin.f3nation.com" } });
    const browser = await load();
    browser.initErrorReporting({ key: "phc_test", app: "admin" });

    expect(register).toHaveBeenCalledWith({
      app: "admin",
      environment: "prod",
    });
  });
});

describe("captureException", () => {
  beforeEach(() => {
    captureException.mockReset();
  });

  it("reports once initialized", async () => {
    const browser = await load();
    browser.initErrorReporting({
      key: "phc_test",
      app: "homepage",
      hostname: "f3nation.com",
    });
    const error = new Error("boom");
    browser.captureException(error, { boundary: "route" });

    expect(captureException).toHaveBeenCalledWith(error, {
      boundary: "route",
    });
  });

  it("never throws when reporting itself fails", async () => {
    const browser = await load();
    browser.initErrorReporting({
      key: "phc_test",
      app: "admin",
      hostname: "admin.f3nation.com",
    });
    captureException.mockImplementation(() => {
      throw new Error("ingest blocked");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => browser.captureException(new Error("boom"))).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      "posthog.capture_exception_failed",
      expect.any(Error),
    );
  });
});
