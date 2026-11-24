import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocationMarkerWithDistance } from "~/app/_components/map/filtered-map-results-provider";

const h = vi.hoisted(() => ({
  setSelectedItem: vi.fn(),
  setView: vi.fn(),
}));

vi.mock("~/utils/store/selected-item", () => ({
  selectedItemStore: { use: { locationId: () => null } },
  setSelectedItem: h.setSelectedItem,
}));
vi.mock("~/utils/set-view", () => ({ setView: h.setView }));

import { NearbyLocationItem } from "~/app/_components/map/nearby-location-item";

type MarkerEvent = LocationMarkerWithDistance["events"][number];

const event = (overrides: Partial<MarkerEvent>): MarkerEvent => ({
  id: 1,
  name: "Speedtrap",
  dayOfWeek: "tuesday",
  startTime: "0515",
  eventTypes: [{ id: 1, name: "Bootcamp" }],
  aoName: "Speedtrap",
  aoLogo: null,
  startDate: null,
  endDate: null,
  mapStatus: null,
  ...overrides,
});

const item = (
  events: MarkerEvent[],
  overrides: Partial<LocationMarkerWithDistance> = {},
): LocationMarkerWithDistance => ({
  id: 7,
  lat: 34.1,
  lon: -81.3,
  logo: null,
  aoName: "Speedtrap",
  fullAddress: "370 A Eptings Camp Rd, Chapin, SC",
  distance: 1.2,
  events,
  ...overrides,
});

const day = (name: string) =>
  document.querySelector<HTMLElement>(`[data-day="${name}"]`)!;

describe("NearbyLocationItem", () => {
  beforeEach(() => {
    h.setSelectedItem.mockReset();
    h.setView.mockReset();
  });

  it("shows the AO, its types, address, meeting days and the odd day's time", () => {
    render(
      <NearbyLocationItem
        item={item([
          event({ id: 1, dayOfWeek: "tuesday" }),
          event({ id: 2, dayOfWeek: "thursday" }),
          event({ id: 3, dayOfWeek: "saturday", startTime: "0630" }),
        ])}
      />,
    );

    expect(screen.getByText("Speedtrap")).toBeTruthy();
    expect(screen.getByText("Bootcamp")).toBeTruthy();
    expect(screen.getByText("370 A Eptings Camp Rd, Chapin, SC")).toBeTruthy();
    expect(screen.getByText("5:15 AM")).toBeTruthy();
    expect(screen.getByText("Saturday starts at 6:30 AM")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Meets Tue, Thu, Sat" }),
    ).toBeTruthy();
    expect(day("tuesday").dataset.meets).toBe("true");
    expect(day("monday").dataset.meets).toBe("false");
    expect(screen.getAllByTestId("day-differs")).toHaveLength(1);
    expect(
      day("saturday").querySelector('[data-testid="day-differs"]'),
    ).toBeTruthy();
  });

  it("falls back to the F3 logo when the row has none", () => {
    render(<NearbyLocationItem item={item([event({})], { logo: "" })} />);
    expect(
      screen.getByAltText("Logo for Speedtrap").getAttribute("src"),
    ).toContain("f3_logo.png");
  });

  it("uses the row's own (AO or region) logo when it has one", () => {
    render(
      <NearbyLocationItem
        item={item([event({})], { logo: "https://region.example/logo.png" })}
      />,
    );
    expect(
      screen.getByAltText("Logo for Speedtrap").getAttribute("src"),
    ).toContain("region.example");
  });

  it("strikes the time and tags the row when the workout is closed", () => {
    render(
      <NearbyLocationItem
        item={item([
          event({
            dayOfWeek: "saturday",
            startTime: "0600",
            mapStatus: "closed",
            statusDetail: {
              status: "closed",
              kind: "instance",
              date: "2026-11-28",
              startTime: null,
              closedThrough: null,
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("6:00 AM").className).toContain("line-through");
    expect(screen.getByText("Closed Sat Nov 28")).toBeTruthy();
    expect(day("saturday").dataset.status).toBe("closed");
  });

  it("reads Times vary when no start time repeats", () => {
    render(
      <NearbyLocationItem
        item={item([
          event({ id: 1, dayOfWeek: "monday", startTime: "0500" }),
          event({ id: 2, dayOfWeek: "wednesday", startTime: "0530" }),
        ])}
      />,
    );
    expect(screen.getByText("Times vary")).toBeTruthy();
    expect(screen.getByText("Mon 5:00 · Wed 5:30 AM")).toBeTruthy();
  });

  it("opens the AO's first workout in the panel and centers the map on it", () => {
    render(
      <NearbyLocationItem
        item={item([event({ id: 11 }), event({ id: 12, dayOfWeek: "friday" })])}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    expect(h.setSelectedItem).toHaveBeenCalledWith({
      locationId: 7,
      eventId: 11,
      showPanel: true,
    });
    expect(h.setView).toHaveBeenCalledWith({ lat: 34.1, lng: -81.3 });
  });
});
