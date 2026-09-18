import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, logWarn, logError } = vi.hoisted(() => {
  const mockEnv: {
    NEXT_PUBLIC_ADMIN_URL?: string;
    NEXT_PUBLIC_CHANNEL?: string;
  } = {};
  return { mockEnv, logWarn: vi.fn(), logError: vi.fn() };
});

vi.mock("@acme/env", () => ({ env: mockEnv }));
vi.mock("../logger", () => ({ logWarn, logError }));

import { getAdminRequestsUrl } from "./admin-url";

const setEnv = (values: typeof mockEnv) => {
  delete mockEnv.NEXT_PUBLIC_ADMIN_URL;
  delete mockEnv.NEXT_PUBLIC_CHANNEL;
  Object.assign(mockEnv, values);
};

describe("getAdminRequestsUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the configured admin URL over the channel default", () => {
    setEnv({
      NEXT_PUBLIC_ADMIN_URL: "https://admin.example.test",
      NEXT_PUBLIC_CHANNEL: "prod",
    });

    expect(getAdminRequestsUrl()).toBe("https://admin.example.test/requests");
    expect(logWarn).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("trims whitespace and trailing slashes from the configured URL", () => {
    setEnv({
      NEXT_PUBLIC_ADMIN_URL: "  http://localhost:3002//  ",
      NEXT_PUBLIC_CHANNEL: "local",
    });

    expect(getAdminRequestsUrl()).toBe("http://localhost:3002/requests");
  });

  it.each([
    ["prod", "https://admin.f3nation.com/requests"],
    ["staging", "https://staging.admin.f3nation.com/requests"],
  ])(
    "falls back to the %s admin host when nothing is configured",
    (channel, expected) => {
      setEnv({ NEXT_PUBLIC_CHANNEL: channel });

      expect(getAdminRequestsUrl()).toBe(expected);
      expect(logWarn).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it.each(["admin.example.test", "localhost:3002", "//admin.example.test"])(
    "ignores a configured value without an http(s) scheme (%s) and warns",
    (configured) => {
      setEnv({
        NEXT_PUBLIC_ADMIN_URL: configured,
        NEXT_PUBLIC_CHANNEL: "staging",
      });

      expect(getAdminRequestsUrl()).toBe(
        "https://staging.admin.f3nation.com/requests",
      );
      expect(logWarn).toHaveBeenCalledWith("api.admin_url.invalid_configured", {
        channel: "staging",
      });
    },
  );

  it.each(["local", "ci", "branch", "dev", undefined])(
    "logs an error and returns the bare path when the %s channel has no URL",
    (channel) => {
      setEnv({ NEXT_PUBLIC_CHANNEL: channel });

      expect(getAdminRequestsUrl()).toBe("/requests");
      expect(logError).toHaveBeenCalledWith("api.admin_url.unresolved", {
        channel,
      });
    },
  );
});
