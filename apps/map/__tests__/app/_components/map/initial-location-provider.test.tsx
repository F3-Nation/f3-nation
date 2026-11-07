import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CLOSE_ZOOM } from "@acme/shared/app/constants";

import {
  InitialLocationProvider,
  useInitialLocation,
} from "~/app/_components/map/initial-location-provider";
import { mapStore } from "~/utils/store/map";

const h = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("~/orpc/react", () => ({
  getQueryData: () => undefined,
  orpc: {
    map: {
      location: { eventsAndLocations: { queryKey: () => ["locations"] } },
    },
  },
}));

const ShowZoom = () => <span>{useInitialLocation().initialZoom}</span>;

const initialZoom = (search: string) => {
  h.search = search;
  render(
    <InitialLocationProvider>
      <ShowZoom />
    </InitialLocationProvider>,
  );
  return Number(screen.getByText(/^\d+(\.\d+)?$/).textContent);
};

describe("InitialLocationProvider initial zoom", () => {
  beforeEach(() => {
    mapStore.setState({ zoom: 7 });
  });

  it("keeps zoom=0 from the URL even with a lat/lon", () => {
    expect(initialZoom("?lat=36.2&lon=-81.66&zoom=0")).toBe(0);
  });

  it("clamps an out-of-range zoom from the URL", () => {
    expect(initialZoom("?zoom=1000000000")).toBe(22);
  });

  it("opens a URL location at street level when there is no zoom", () => {
    expect(initialZoom("?lat=36.2&lon=-81.66")).toBe(CLOSE_ZOOM);
  });

  it("falls back to the stored zoom", () => {
    expect(initialZoom("")).toBe(7);
  });
});
