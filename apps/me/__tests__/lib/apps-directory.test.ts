import { beforeEach, describe, expect, it, vi } from "vitest";

const logWarn = vi.fn();
vi.mock("@/lib/logging", () => ({ logWarn }));

const { appsDirectoryUrl } = await import("@/lib/apps-directory");

beforeEach(() => logWarn.mockClear());

describe("appsDirectoryUrl", () => {
  it.each([
    [undefined, undefined],
    ["true", ""],
    [" TRUE ", "  "],
  ])(
    "defaults to the production directory (enabled=%j, url=%j)",
    (flag, url) => {
      expect(appsDirectoryUrl(flag, url)?.href).toBe(
        "https://apps.f3nation.com/",
      );
    },
  );

  it.each(["false", " FALSE "])("hides the card for enabled=%j", (flag) => {
    expect(
      appsDirectoryUrl(flag, "https://staging.apps.f3nation.com"),
    ).toBeNull();
    expect(appsDirectoryUrl(flag, "javascript:alert(1)")).toBeNull();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("uses a configured directory", () => {
    expect(
      appsDirectoryUrl(undefined, "https://staging.apps.f3nation.com")?.href,
    ).toBe("https://staging.apps.f3nation.com/");
  });

  it.each(["apps.f3nation.com", "off", "javascript:alert(1)", "https://"])(
    "hides the card and warns for the bad URL %j",
    (url) => {
      expect(appsDirectoryUrl(undefined, url)).toBeNull();
      expect(logWarn).toHaveBeenCalledWith("me.apps_directory.invalid_url", {
        reason: `APPS_DIRECTORY_URL must be an http(s) URL, got "${url}"`,
      });
    },
  );
});
