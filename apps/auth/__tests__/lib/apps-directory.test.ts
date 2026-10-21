import { describe, expect, it } from "vitest";

import { appsDirectoryUrl } from "../../src/lib/apps-directory";

describe("appsDirectoryUrl", () => {
  it.each([undefined, "", "  "])(
    "defaults to the production directory when unset (%j)",
    (raw) => {
      expect(appsDirectoryUrl(raw)?.href).toBe("https://apps.f3nation.com/");
    },
  );

  it.each(["off", "OFF", " off "])("hides the link for %j", (raw) => {
    expect(appsDirectoryUrl(raw)).toBeNull();
  });

  it("uses a configured directory", () => {
    const url = appsDirectoryUrl("https://staging.apps.f3nation.com");
    expect(url?.href).toBe("https://staging.apps.f3nation.com/");
    expect(url?.host).toBe("staging.apps.f3nation.com");
  });

  it("throws on a value that is neither a URL nor off", () => {
    expect(() => appsDirectoryUrl("apps.f3nation.com")).toThrow();
  });
});
