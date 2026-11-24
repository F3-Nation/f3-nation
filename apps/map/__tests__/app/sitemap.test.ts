// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted((): { F3_MAP_BASE_URL: string | undefined } => ({
  F3_MAP_BASE_URL: "",
}));

vi.mock("~/env", () => ({ env: mockEnv }));

import sitemap, { dynamic } from "~/app/sitemap";

describe("sitemap.xml", () => {
  beforeEach(() => {
    mockEnv.F3_MAP_BASE_URL = "https://staging.map.f3nation.com";
  });

  it("lists the root, help and changelog pages on the configured site URL", () => {
    expect(sitemap()).toEqual([
      {
        url: "https://staging.map.f3nation.com/",
        changeFrequency: "daily",
        priority: 1,
      },
      {
        url: "https://staging.map.f3nation.com/help",
        changeFrequency: "monthly",
        priority: 0.5,
      },
      {
        url: "https://staging.map.f3nation.com/changelog",
        changeFrequency: "weekly",
        priority: 0.3,
      },
    ]);
  });

  it("is rendered per request, never at image build time", () => {
    expect(dynamic).toBe("force-dynamic");
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
