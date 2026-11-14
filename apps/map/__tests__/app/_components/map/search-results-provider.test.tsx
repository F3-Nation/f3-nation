import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SparseF3Marker } from "~/utils/types";

const h = vi.hoisted(() => ({
  calls: [] as {
    input: string;
    cb: (results: unknown[]) => void;
    cleanup: ReturnType<typeof vi.fn>;
  }[],
  queryData: { regions: undefined as unknown[] | undefined },
  markers: { value: [] as SparseF3Marker[] },
}));

vi.mock("~/utils/place-autocomplete", () => ({
  debouncedPlacesAutocomplete: (
    input: string,
    _center: unknown,
    _zoom: unknown,
    cb: (results: unknown[]) => void,
  ) => {
    const cleanup = vi.fn();
    h.calls.push({ input, cb, cleanup });
    return cleanup;
  },
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
  useQuery: () => ({
    data: { regionsWithLocation: h.queryData.regions, lookup: undefined },
  }),
}));

vi.mock("~/orpc/query-client", () => ({
  MAP_DATASET_STALE_TIME_MS: 0,
}));

vi.mock("~/app/_components/map/filtered-map-results-provider", () => ({
  useFilteredMapResults: () => ({
    filteredLocationMarkers: h.markers.value,
  }),
}));

vi.mock("~/utils/hooks/use-is-mobile-width", () => ({
  useIsMobileWidth: () => ({ isMobileWidth: false }),
}));

vi.mock("~/utils/store/map", () => ({
  mapStore: {
    get: (key: string) => (key === "zoom" ? 10 : { lat: 0, lng: 0 }),
  },
}));

import {
  TextSearchResultsProvider,
  useTextSearchResults,
} from "~/app/_components/map/search-results-provider";
import { searchStore } from "~/utils/store/search";

const place = (id: string) => ({
  placePrediction: {
    placeId: id,
    structuredFormat: { mainText: { text: id } },
  },
});

const type = (text: string) => {
  act(() => searchStore.setState({ text }));
};

const keys = (testId: string) => screen.getByTestId(testId).textContent;

const Probe = () => {
  const { f3RegionResults, f3LocationResults, geoResults, combinedResults } =
    useTextSearchResults();

  return (
    <>
      <div data-testid="regions">
        {f3RegionResults.map((result) => result.key).join(",")}
      </div>
      <div data-testid="locations">
        {f3LocationResults.map((result) => result.key).join(",")}
      </div>
      <div data-testid="geo">
        {geoResults.map((result) => result.key).join(",")}
      </div>
      <div data-testid="combined">
        {combinedResults.map((result) => result.key).join(",")}
      </div>
    </>
  );
};

const renderProvider = () =>
  render(
    <TextSearchResultsProvider>
      <Probe />
    </TextSearchResultsProvider>,
  );

afterEach(() => {
  act(() => searchStore.setState({ text: "" }));
  h.calls.length = 0;
  h.queryData.regions = undefined;
  h.markers.value = [];
  vi.clearAllMocks();
});

describe("TextSearchResultsProvider", () => {
  it("clears geo and combined results when the query changes", () => {
    renderProvider();

    type("abc");
    const abcCall = h.calls.find((call) => call.input === "abc");
    expect(abcCall).toBeDefined();
    act(() => abcCall?.cb([place("p1")]));
    expect(keys("geo")).toBe("geo-p1");

    type("abcd");
    expect(keys("geo")).toBe("");
    expect(keys("combined")).toBe("");
  });

  it("ignores stale autocomplete responses", () => {
    renderProvider();

    type("abc");
    type("abcd");

    const abcCall = h.calls.find((call) => call.input === "abc");
    const abcdCall = h.calls.find((call) => call.input === "abcd");
    expect(abcCall).toBeDefined();
    expect(abcdCall).toBeDefined();

    act(() => abcdCall?.cb([place("p2")]));
    act(() => abcCall?.cb([place("p1")]));

    expect(keys("geo")).toBe("geo-p2");
    expect(abcCall?.cleanup).toHaveBeenCalledTimes(1);
  });

  it("shows all result kinds at three characters and none below the threshold", () => {
    h.queryData.regions = [
      { id: 1, name: "Dark Region", lat: 1, lon: 1, logo: null, locationId: 1 },
    ];
    h.markers.value = [
      {
        id: 2,
        lat: 1,
        lon: 1,
        logo: null,
        aoName: "The Dark Tower",
        fullAddress: "x",
        events: [
          {
            id: 2,
            name: "Dark Tower Bootcamp",
            dayOfWeek: "monday",
            startTime: "0530",
            eventTypes: [],
            aoName: "The Dark Tower",
            aoLogo: null,
            startDate: "2026-01-01",
            endDate: null,
            mapStatus: null,
          },
        ],
      },
    ];
    renderProvider();

    type("dark");
    const darkCall = h.calls.find((call) => call.input === "dark");
    expect(darkCall).toBeDefined();
    act(() => darkCall?.cb([place("p1")]));

    for (const testId of ["regions", "locations", "geo", "combined"]) {
      expect(keys(testId)).not.toBe("");
    }

    h.calls.length = 0;
    type("da");
    for (const testId of ["regions", "locations", "geo", "combined"]) {
      expect(keys(testId)).toBe("");
    }
    expect(h.calls.some((call) => call.input === "da")).toBe(false);
  });
});
