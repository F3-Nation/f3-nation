/**
 * The hydrator hands the server-rendered map datasets to React Query. Whether
 * the browser re-downloads them on mount depends on how old that copy is: a
 * fresh render is used as is, an ISR page older than the datasets' staleTime
 * refetches once, and a failed refetch keeps showing the data it already has.
 */

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchEvents, fetchRegions } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  fetchRegions: vi.fn(),
}));

// Real useQuery; only the oRPC option factories are replaced so each query's
// fetch is a spy.
vi.mock("~/orpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const options =
    (key: string, queryFn: () => unknown) =>
    (opts: Record<string, unknown>) => ({
      ...opts,
      queryKey: ["map", key],
      queryFn,
      retry: false,
    });
  return {
    useQuery,
    orpc: {
      map: {
        location: {
          eventsAndLocations: {
            queryOptions: options("eventsAndLocations", () => fetchEvents()),
          },
          regionsWithLocation: {
            queryOptions: options("regionsWithLocation", () => fetchRegions()),
          },
        },
      },
    },
  };
});

import { ReactQueryHydrator } from "~/app/_components/map/react-query-hydrator";
import {
  createQueryClient,
  MAP_DATASET_STALE_TIME_MS,
} from "~/orpc/query-client";

type Props = Parameters<typeof ReactQueryHydrator>[0];
const events = [
  [1, "AO", null, 35.5, -80.5, null, []],
] as unknown as Props["eventsAndLocations"];
const regions = {
  regionsWithLocation: [
    { id: 1, name: "Region", locationId: 1, lat: 35.5, lon: -80.5, logo: null },
  ],
} as Props["regionsWithLocation"];

const renderHydrator = (props: Partial<Props>) => {
  const client = createQueryClient();
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    wrap(
      <ReactQueryHydrator
        eventsAndLocations={events}
        regionsWithLocation={regions}
        dataFetchedAt={Date.now()}
        {...props}
      >
        <p>map</p>
      </ReactQueryHydrator>,
    ),
  );
  return client;
};

describe("ReactQueryHydrator", () => {
  beforeEach(() => {
    fetchEvents.mockReset().mockResolvedValue(events);
    fetchRegions.mockReset().mockResolvedValue(regions);
  });

  it("uses a freshly rendered copy without refetching on mount", async () => {
    renderHydrator({ dataFetchedAt: Date.now() });

    expect(screen.getByText("map")).toBeTruthy();
    // Give any mount fetch a chance to start before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchEvents).not.toHaveBeenCalled();
    expect(fetchRegions).not.toHaveBeenCalled();
  });

  it("refetches once on mount when the rendered copy is older than staleTime", async () => {
    renderHydrator({
      dataFetchedAt: Date.now() - MAP_DATASET_STALE_TIME_MS - 1_000,
    });

    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(1));
    expect(fetchRegions).toHaveBeenCalledTimes(1);
  });

  it("keeps the rendered map when that refetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchEvents.mockRejectedValue(new Error("API down"));
    const client = renderHydrator({
      dataFetchedAt: Date.now() - MAP_DATASET_STALE_TIME_MS - 1_000,
    });

    await waitFor(() =>
      expect(client.getQueryState(["map", "eventsAndLocations"])?.status).toBe(
        "error",
      ),
    );
    expect(screen.getByText("map")).toBeTruthy();
    expect(client.getQueryData(["map", "eventsAndLocations"])).toEqual(events);
  });

  it("fetches when the build skipped SSG and passed empty datasets", async () => {
    renderHydrator({
      eventsAndLocations: [],
      regionsWithLocation: { regionsWithLocation: [] },
    });

    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(1));
    expect(fetchRegions).toHaveBeenCalledTimes(1);
  });
});
