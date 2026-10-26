import { afterEach, describe, expect, it, vi } from "vitest";

import { getSiteUrl, nonEmpty } from "@/lib/site";

const mockEnv = vi.hoisted(() => ({
  SITE_URL: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

afterEach(() => {
  mockEnv.SITE_URL = undefined;
});

describe("nonEmpty", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["   ", undefined],
    [" G-123 ", "G-123"],
  ])("%j -> %j", (input, expected) => {
    expect(nonEmpty(input)).toBe(expected);
  });
});

describe("getSiteUrl", () => {
  it("falls back to production when SITE_URL is unset or empty", () => {
    expect(getSiteUrl()).toBe("https://regions2.f3nation.com");
    mockEnv.SITE_URL = "";
    expect(getSiteUrl()).toBe("https://regions2.f3nation.com");
  });

  it("returns SITE_URL without trailing slashes", () => {
    mockEnv.SITE_URL = "https://staging.example.com//";
    expect(getSiteUrl()).toBe("https://staging.example.com");
  });
});
