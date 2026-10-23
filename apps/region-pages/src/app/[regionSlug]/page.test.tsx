import { describe, expect, it, vi } from "vitest";

import type { Region, Workout } from "@/types/region";
import RegionPage, { generateMetadata } from "@/app/[regionSlug]/page";
import { getRegion } from "@/lib/data";

vi.mock("@/lib/data", () => ({ getRegion: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const region = {
  id: "1",
  name: "Albuquerque",
  slug: "albuquerque",
  city: "Albuquerque",
  state: "NM",
  image: "https://storage.googleapis.com/f3-public-images/abq.jpeg",
  latitude: 35.1,
  longitude: -106.6,
  zoom: 10,
} as Region;
const workout = { location: "1 Main St, Albuquerque, NM" } as Workout;
const params = Promise.resolve({ regionSlug: "albuquerque" });

describe("region page", () => {
  it("titles a region with workouts by name and city, with its own canonical/og url", async () => {
    vi.mocked(getRegion).mockResolvedValue({ region, workouts: [workout] });

    const metadata = await generateMetadata({ params });

    expect(metadata.title).toBe("F3 Albuquerque Workouts (Albuquerque, NM)");
    expect(metadata.description).toContain(
      "serving 1 Main St, Albuquerque, NM",
    );
    expect(metadata.alternates?.canonical).toBe("/albuquerque");
    expect(metadata.openGraph).toMatchObject({
      url: "/albuquerque",
      images: [{ url: region.image }],
    });
  });

  it("marks a region without workouts as coming soon", async () => {
    vi.mocked(getRegion).mockResolvedValue({ region, workouts: [] });

    const metadata = await generateMetadata({ params });

    expect(metadata.title).toBe("F3 Albuquerque - Coming Soon");
  });

  it("404s an unknown slug", async () => {
    vi.mocked(getRegion).mockResolvedValue(null);

    expect((await generateMetadata({ params })).title).toBe("Region Not Found");
    await expect(RegionPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
