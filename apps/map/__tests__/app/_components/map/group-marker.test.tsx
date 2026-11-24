import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  groupMarkerClick: vi.fn(() => Promise.resolve()),
  panelLocationId: { current: null as number | null },
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  AdvancedMarker: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: (e: { stop: () => void }) => void;
  }) => (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-testid="marker"
      onClick={() => onClick?.({ stop: () => undefined })}
    >
      {children}
    </div>
  ),
  useAdvancedMarkerRef: () => [() => undefined, null],
}));
vi.mock("~/utils/actions/group-marker-click", () => ({
  groupMarkerClick: h.groupMarkerClick,
}));
vi.mock("~/utils/touch-device-provider", () => ({
  useTouchDevice: () => ({ isTouchDevice: false }),
}));
vi.mock("~/utils/store/selected-item", () => ({
  selectedItemStore: {
    use: {
      locationId: () => null,
      eventId: () => null,
      panelLocationId: () => h.panelLocationId.current,
      panelEventId: () => null,
    },
  },
  setSelectedItem: vi.fn(),
  delayedDeselect: vi.fn(),
}));
vi.mock("~/app/_components/map/filtered-map-results-provider", () => ({
  useFilteredMapResults: () => ({
    filteredLocationMarkers: [
      {
        id: 5,
        aoName: "The Roost",
        events: [
          { id: 1, dayOfWeek: "tuesday", mapStatus: null, aoName: "The Roost" },
          {
            id: 2,
            dayOfWeek: "thursday",
            mapStatus: null,
            aoName: "The Roost",
          },
          { id: 3, dayOfWeek: "saturday", mapStatus: null, aoName: "Havoc" },
          {
            id: 4,
            dayOfWeek: "thursday",
            mapStatus: "closed",
            aoName: "Havoc",
          },
        ],
      },
    ],
  }),
}));

import { FeatureMarker } from "~/app/_components/map/group-marker";

const renderMarker = (showDayLabels: boolean) =>
  render(
    <FeatureMarker
      featureId="5"
      position={{ lat: 34, lng: -81 }}
      showDayLabels={showDayLabels}
    />,
  );

describe("FeatureMarker", () => {
  beforeEach(() => {
    h.groupMarkerClick.mockClear();
    h.panelLocationId.current = null;
  });

  it("is a plain pin below the day-label zoom", () => {
    renderMarker(false);
    expect(screen.getByRole("img", { name: "The Roost" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    fireEvent.click(screen.getByTestId("marker"));
    expect(h.groupMarkerClick).toHaveBeenCalledWith({
      locationId: 5,
      eventId: 1,
    });
  });

  it("shows each workout day once, in week order, from the day-label zoom", () => {
    renderMarker(true);
    const days = screen.getAllByRole("button");
    expect(days.map((d) => d.textContent)).toEqual(["Tu", "Th", "Sa"]);
    // Thursday has a closed workout, so it takes the closed color.
    expect(days[1]?.className).toContain("bg-gray-500");
    expect(days[0]?.className).toContain("bg-primary");
  });

  it("opens the first workout on the day that was clicked", () => {
    renderMarker(true);
    fireEvent.click(screen.getByRole("button", { name: "Sa" }));
    expect(h.groupMarkerClick).toHaveBeenCalledWith({
      locationId: 5,
      eventId: 3,
    });
  });
});
