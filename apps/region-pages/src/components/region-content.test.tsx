import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Workout } from "@/types/region";
import { RegionContent } from "@/components/region-content";

// On an ISR page, components that read the query string can't render on the
// server: Next renders their Suspense fallback instead. Suspending forever
// here reproduces that, so the test sees exactly the server HTML's content.
vi.mock("next/navigation", async () => {
  const { use } = await import("react");
  const never = new Promise<never>(() => undefined);
  return {
    useSearchParams: () => use(never),
    useRouter: () => ({ push: vi.fn() }),
  };
});

const workout = {
  id: "1",
  regionId: "9",
  name: "South End Station Bootcamp",
  time: "5:30 AM - 6:15 AM",
  type: "Bootcamp",
  types: ["Bootcamp"],
  group: "monday",
  notes: null,
  latitude: 35.2,
  longitude: -80.8,
  location: "1 Main St, Charlotte, NC",
  city: "Charlotte",
  state: "NC",
  zip: "28203",
  country: "US",
} satisfies Workout;

describe("RegionContent server HTML", () => {
  it("contains the workouts, not a loading placeholder", () => {
    const html = renderToString(
      <RegionContent
        regionSlug="charlotte"
        regionName="Charlotte"
        sortedWorkouts={[workout]}
        mapParams={{ center: { lat: 35.2, lng: -80.8 }, zoom: 11 }}
      />,
    );

    expect(html).toContain("South End Station Bootcamp");
    expect(html).toContain("5:30 AM - 6:15 AM");
    expect(html).not.toContain("Loading");
  });
});
