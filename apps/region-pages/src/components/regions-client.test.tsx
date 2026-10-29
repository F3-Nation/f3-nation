import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Region } from "@/types/region";
import { RegionsClient } from "@/components/regions-client";
import { calculateHaversineDistance } from "@/lib/map-utils";
import { toRegionSummary } from "@/types/region";

let letterParam: string | null = null;
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(letterParam ? { letter: letterParam } : {}),
  useRouter: () => ({ push }),
}));

const makeRegion = (overrides: Partial<Region> = {}): Region => ({
  id: "1",
  name: "Albuquerque",
  slug: "albuquerque",
  description: "desc",
  website: "https://f3abq.com",
  image: null,
  email: null,
  facebook: null,
  twitter: null,
  instagram: null,
  city: "Albuquerque",
  state: "NM",
  zip: "87113",
  country: "US",
  latitude: 35.1,
  longitude: -106.6,
  zoom: 10,
  workoutCount: 10,
  ...overrides,
});

describe("toRegionSummary", () => {
  it("keeps only the fields the directory renders", () => {
    expect(toRegionSummary(makeRegion())).toEqual({
      name: "Albuquerque",
      slug: "albuquerque",
      city: "Albuquerque",
      state: "NM",
      zip: "87113",
      country: "US",
      latitude: 35.1,
      longitude: -106.6,
      workoutCount: 10,
    });
  });
});

describe("RegionsClient", () => {
  afterEach(() => {
    cleanup();
    letterParam = null;
  });

  const regions = [
    makeRegion(),
    makeRegion({ id: "2", name: "Boone", slug: "boone", city: null }),
  ].map(toRegionSummary);

  it("renders the A regions as links on first render (no skeleton)", () => {
    render(<RegionsClient regions={regions} />);
    expect(screen.getByRole("link", { name: /Albuquerque/ })).toHaveAttribute(
      "href",
      "/albuquerque",
    );
    expect(screen.queryByRole("link", { name: /Boone/ })).toBeNull();
    expect(
      screen.getByText('Showing 1 regions starting with "A"'),
    ).toBeInTheDocument();
  });

  it("follows the ?letter= param", () => {
    letterParam = "b";
    render(<RegionsClient regions={regions} />);
    expect(screen.getByRole("link", { name: /Boone/ })).toHaveAttribute(
      "href",
      "/boone",
    );
  });

  it("highlights a single search match so Enter opens it", () => {
    render(<RegionsClient regions={regions} />);
    const input = screen.getByLabelText("Search regions");

    fireEvent.change(input, { target: { value: "boo" } });

    expect(
      screen.getByRole("option", { name: /Boone/, selected: true }),
    ).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/boone");
  });
});

describe("near me", () => {
  const HERE = { latitude: 35.1, longitude: -106.6 };

  const stubGeolocation = (
    getCurrentPosition: (
      ok: (position: GeolocationPosition) => void,
      err: (error: GeolocationPositionError) => void,
    ) => void,
  ) => {
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
  };

  afterEach(() => {
    cleanup();
    delete (globalThis.navigator as { geolocation?: unknown }).geolocation;
  });

  it("lists only regions within 200 miles, with their distance in miles", () => {
    stubGeolocation((ok) =>
      ok({ coords: HERE } as unknown as GeolocationPosition),
    );
    const nearLat = 35.82; // ~50 miles north
    const farLat = 38.72; // ~250 miles north
    const regions = [
      makeRegion({
        id: "10",
        name: "Near Town",
        slug: "near-town",
        latitude: nearLat,
        longitude: HERE.longitude,
      }),
      makeRegion({
        id: "11",
        name: "Far Town",
        slug: "far-town",
        latitude: farLat,
        longitude: HERE.longitude,
      }),
      makeRegion({
        id: "12",
        name: "Nowhere",
        slug: "nowhere",
        latitude: null,
        longitude: null,
      }),
    ].map(toRegionSummary);

    render(<RegionsClient regions={regions} />);
    fireEvent.click(screen.getByLabelText("Find regions near me"));

    expect(screen.getByRole("link", { name: /Near Town/ })).toHaveAttribute(
      "href",
      "/near-town",
    );
    expect(screen.queryByRole("link", { name: /Far Town/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Nowhere/ })).toBeNull();
    expect(
      screen.getByText(
        `${(calculateHaversineDistance(HERE.latitude, HERE.longitude, nearLat, HERE.longitude) * 0.621371).toFixed(1)} miles away`,
      ),
    ).toBeInTheDocument();
  });

  it("shows a permission message and returns to alphabetical navigation when location is denied", () => {
    stubGeolocation((_ok, err) =>
      err({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError),
    );
    const regions = [makeRegion()].map(toRegionSummary);

    render(<RegionsClient regions={regions} />);
    fireEvent.click(screen.getByLabelText("Find regions near me"));

    expect(
      screen.getByText(
        "Location access denied. Please enable location services.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Alphabetical navigation"),
    ).toBeInTheDocument();
  });
});
