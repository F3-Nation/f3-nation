import { render, screen } from "@testing-library/react";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SparseF3Marker } from "~/utils/types";

import { buildF3LocationSearchResults } from "~/app/_components/map/search-results";

const h = vi.hoisted(() => ({
  combinedResults: [] as unknown[],
}));

vi.mock("~/app/_components/map/search-results-provider", () => ({
  useTextSearchResults: () => ({ combinedResults: h.combinedResults }),
}));
vi.mock("~/app/_components/map/filtered-map-results-provider", () => ({
  useFilteredMapResults: () => ({ aoGroupedLocationMarkers: [] }),
}));
vi.mock("~/utils/store/search", () => ({
  searchStore: {
    use: { shouldShowResults: () => true, text: () => "the" },
    setState: vi.fn(),
  },
}));
vi.mock("~/utils/store/map", () => ({
  mapStore: { use: {}, get: vi.fn(), setState: vi.fn() },
}));
vi.mock("~/orpc/react", () => ({
  orpc: new Proxy(
    {},
    {
      get: function get(): unknown {
        return new Proxy(() => ({}), { get });
      },
    },
  ),
  useQuery: () => ({ data: undefined }),
}));
vi.mock("~/utils/key-press/hook", () => ({
  useKeyPress: () => ({ pressedKeys: new Set() }),
}));
vi.mock("~/utils/hooks/use-on-key-press", () => ({
  useOnKeyPress: () => ({ ref: { current: null } }),
}));
vi.mock("~/utils/place-autocomplete", () => ({
  debouncedPlacesAutocomplete: vi.fn(),
}));
vi.mock("@acme/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("~/app/_components/map/place-row-f3-location", () => ({
  onClickPlaceRowF3Location: vi.fn(),
  PlaceRowF3Location: ({ result }: { result: { key: string } }) => (
    <div data-testid="result-row">{result.key}</div>
  ),
}));

import { MapSearchBox } from "~/app/_components/map/map-searchbox-desktop";
import { MobileSearchResultsAndNearbyLocations } from "~/app/_components/map/mobile-search-results-and-nearby-locations";

const baseEvent: SparseF3Marker["events"][number] = {
  id: 2,
  name: "The Dark Tower Bootcamp",
  dayOfWeek: "monday",
  startTime: "0530",
  eventTypes: [],
  aoName: "The Dark Tower",
  aoLogo: null,
  startDate: "2026-01-01",
  endDate: null,
  mapStatus: null,
};

// Location 2 collides with event 2, and location 7 hosts two AOs.
const markers: SparseF3Marker[] = [
  {
    id: 2,
    lat: 35.5,
    lon: -80.5,
    logo: null,
    aoName: "The Dark Tower",
    fullAddress: "123 Main St",
    events: [baseEvent],
  },
  {
    id: 7,
    lat: 35.6,
    lon: -80.6,
    logo: null,
    aoName: "The Gunslinger",
    fullAddress: "7 Main St",
    events: [
      { ...baseEvent, id: 70, name: "Tower Mon", aoName: "The Tower" },
      {
        ...baseEvent,
        id: 72,
        name: "Gunslinger Run",
        aoName: "The Gunslinger",
      },
    ],
  },
];

const duplicateKeyWarnings = (spy: MockInstance<typeof console.error>) =>
  spy.mock.calls.filter((args) =>
    args.some((arg: unknown) => String(arg).includes("same key")),
  );

describe("search result lists render colliding ids once", () => {
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    h.combinedResults = buildF3LocationSearchResults({
      locationMarkers: markers,
      text: "the",
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const expectEachResultOnce = () => {
    const keys = (h.combinedResults as { key: string }[]).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const rendered = screen
      .getAllByTestId("result-row")
      .map((row) => row.textContent);
    expect(rendered.sort()).toEqual([...keys].sort());
    expect(duplicateKeyWarnings(errorSpy)).toEqual([]);
  };

  it("mobile list", () => {
    render(<MobileSearchResultsAndNearbyLocations />);
    expectEachResultOnce();
  });

  it("desktop list", () => {
    render(<MapSearchBox />);
    expectEachResultOnce();
  });
});
