import { afterEach, describe, expect, it, vi } from "vitest";

import sitemap from "@/app/sitemap";

vi.mock("@/lib/data", () => ({
  getRegions: vi
    .fn()
    .mockResolvedValue([{ slug: "albuquerque" }, { slug: "boone" }]),
}));
vi.mock("@/lib/region-events", () => ({
  getAllEventStaticParams: () => [
    { regionSlug: "boone", eventSlug: "abc123-convergence" },
  ],
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap", () => {
  it("lists home, every region and every curated event on SITE_URL", async () => {
    vi.stubEnv("SITE_URL", "https://staging.regions.f3nation.com");

    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toEqual([
      "https://staging.regions.f3nation.com/",
      "https://staging.regions.f3nation.com/albuquerque",
      "https://staging.regions.f3nation.com/boone",
      "https://staging.regions.f3nation.com/boone/events/abc123-convergence",
    ]);
  });
});
