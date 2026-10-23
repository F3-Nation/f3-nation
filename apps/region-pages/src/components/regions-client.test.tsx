import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Region } from "@/types/region";
import { RegionsClient } from "@/components/regions-client";
import { toRegionSummary } from "@/types/region";

let letterParam: string | null = null;

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(letterParam ? { letter: letterParam } : {}),
  useRouter: () => ({ push: vi.fn() }),
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
});
