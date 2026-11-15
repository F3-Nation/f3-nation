// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ F3_MAP_BASE_URL: "" }));

vi.mock("~/env", () => ({ env: mockEnv }));

import robots from "~/app/robots";

describe("robots.txt", () => {
  beforeEach(() => {
    mockEnv.F3_MAP_BASE_URL = "https://staging.map.f3nation.com";
  });

  it("allows crawling and points at the sitemap on the configured URL", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://staging.map.f3nation.com/sitemap.xml",
    });
  });

  it("drops a trailing slash so the sitemap URL has no double slash", () => {
    mockEnv.F3_MAP_BASE_URL = "https://map.f3nation.com///";

    expect(robots().sitemap).toBe("https://map.f3nation.com/sitemap.xml");
  });

  it("reads the URL on every request, not once at import", () => {
    expect(robots().sitemap).toBe(
      "https://staging.map.f3nation.com/sitemap.xml",
    );

    mockEnv.F3_MAP_BASE_URL = "https://map.f3nation.com";

    expect(robots().sitemap).toBe("https://map.f3nation.com/sitemap.xml");
  });

  it("falls back to localhost when the URL is empty (validation skipped)", () => {
    mockEnv.F3_MAP_BASE_URL = "   ";

    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});
