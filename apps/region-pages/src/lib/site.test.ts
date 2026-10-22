import { afterEach, describe, expect, it, vi } from "vitest";

import { getSiteUrl, nonEmpty } from "@/lib/site";

afterEach(() => {
  vi.unstubAllEnvs();
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
  it("falls back to production when SITE_URL is unset", () => {
    vi.stubEnv("SITE_URL", undefined);
    expect(getSiteUrl()).toBe("https://regions.f3nation.com");
  });

  it("falls back to production when SITE_URL is empty (would crash new URL)", () => {
    vi.stubEnv("SITE_URL", "");
    expect(getSiteUrl()).toBe("https://regions.f3nation.com");
  });

  it("returns SITE_URL without trailing slashes", () => {
    vi.stubEnv("SITE_URL", "https://staging.example.com//");
    expect(getSiteUrl()).toBe("https://staging.example.com");
  });
});
