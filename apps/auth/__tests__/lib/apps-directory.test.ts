import { describe, expect, it } from "vitest";

import {
  appsDirectoryUrl,
  parseAppsDirectoryUrl,
} from "../../src/lib/apps-directory";

describe("appsDirectoryUrl", () => {
  it.each([undefined, "", "  "])(
    "defaults to the production directory when unset (%j)",
    (raw) => {
      expect(appsDirectoryUrl(undefined, raw)?.href).toBe(
        "https://apps.f3nation.com/",
      );
    },
  );

  it.each(["true", "", " TRUE "])("shows the link for enabled=%j", (flag) => {
    expect(appsDirectoryUrl(flag, undefined)?.href).toBe(
      "https://apps.f3nation.com/",
    );
  });

  it.each(["false", "FALSE", " false "])(
    "hides the link for enabled=%j, whatever the URL",
    (flag) => {
      expect(appsDirectoryUrl(flag, undefined)).toBeNull();
      expect(
        appsDirectoryUrl(flag, "https://staging.apps.f3nation.com"),
      ).toBeNull();
    },
  );

  it("hides the link when disabled even with a bad URL", () => {
    expect(appsDirectoryUrl("false", "javascript:alert(1)")).toBeNull();
  });

  it("uses a configured directory", () => {
    const url = appsDirectoryUrl(
      undefined,
      "https://staging.apps.f3nation.com",
    );
    expect(url?.href).toBe("https://staging.apps.f3nation.com/");
    expect(url?.host).toBe("staging.apps.f3nation.com");
  });

  it("keeps a port and path", () => {
    const url = appsDirectoryUrl(undefined, "http://localhost:3000/apps");
    expect(url?.host).toBe("localhost:3000");
    expect(url?.href).toBe("http://localhost:3000/apps");
  });

  it.each([
    "apps.f3nation.com",
    "off",
    "javascript:alert(1)",
    "ftp://apps.f3nation.com",
    "https://",
    "mailto:a@b.co",
  ])("rejects %j: parse throws, the page helper hides the link", (raw) => {
    expect(() => parseAppsDirectoryUrl(raw)).toThrow(/APPS_DIRECTORY_URL/);
    expect(appsDirectoryUrl(undefined, raw)).toBeNull();
  });
});
