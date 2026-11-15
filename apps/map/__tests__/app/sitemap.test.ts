// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  F3_MAP_BASE_URL: "" as string | undefined,
}));

vi.mock("~/env", () => ({ env: mockEnv }));

import sitemap from "~/app/sitemap";

describe("sitemap.xml", () => {
  beforeEach(() => {
    mockEnv.F3_MAP_BASE_URL = "https://staging.map.f3nation.com";
  });

  it("lists the map's root URL on the configured site URL", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://staging.map.f3nation.com/",
    ]);
  });

  it("follows the configured URL per request and the localhost fallback", () => {
    mockEnv.F3_MAP_BASE_URL = "https://map.f3nation.com/";
    expect(sitemap()[0]?.url).toBe("https://map.f3nation.com/");

    mockEnv.F3_MAP_BASE_URL = "";
    expect(sitemap()[0]?.url).toBe("http://localhost:3000/");
  });

  it("falls back to localhost when the URL is unset (validation skipped)", () => {
    mockEnv.F3_MAP_BASE_URL = undefined;

    expect(sitemap()[0]?.url).toBe("http://localhost:3000/");
  });
});
