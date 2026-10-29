import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRegion, fetchRegions } from "@/lib/api";
import { getRegion } from "@/lib/data";

vi.mock("next/cache", () => ({
  // Pass-through: these tests cover the slug guard, not Next's cache.
  unstable_cache: <T>(fn: T) => fn,
}));
vi.mock("@/lib/api", () => ({ fetchRegions: vi.fn(), fetchRegion: vi.fn() }));

describe("getRegion", () => {
  beforeEach(() => {
    vi.mocked(fetchRegions).mockResolvedValue([
      { slug: "albuquerque" },
    ] as Awaited<ReturnType<typeof fetchRegions>>);
    vi.mocked(fetchRegion).mockReset();
  });

  it("rejects an unknown slug without calling the region endpoint", async () => {
    expect(await getRegion("wp-login.php")).toBeNull();
    expect(fetchRegion).not.toHaveBeenCalled();
  });

  it("fetches a slug that is in the region list", async () => {
    const data = { region: {}, workouts: [] } as unknown as Awaited<
      ReturnType<typeof fetchRegion>
    >;
    vi.mocked(fetchRegion).mockResolvedValue(data);

    expect(await getRegion("albuquerque")).toBe(data);
    expect(fetchRegion).toHaveBeenCalledWith("albuquerque");
  });
});
