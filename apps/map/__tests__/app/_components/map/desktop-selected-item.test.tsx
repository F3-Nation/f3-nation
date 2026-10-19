import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SELECTED_ITEM_DEBOUNCE_TIME_MS } from "@acme/shared/app/constants";

const h = vi.hoisted(() => ({
  query: vi.fn<(options: unknown) => Promise<unknown>>(),
  mapEvent: { current: "idle" },
  selectedItem: {
    current: {},
  },
}));

vi.mock("~/orpc/react", () => ({
  getQueryClient: () => ({ query: h.query }),
  orpc: {
    map: {
      location: {
        locationWorkout: {
          queryOptions: (options: unknown) => ({ queryKey: options }),
        },
      },
    },
  },
}));
vi.mock("~/utils/store/map", () => ({
  mapStore: { use: { event: () => h.mapEvent.current } },
}));
vi.mock("~/utils/store/selected-item", () => ({
  selectedItemStore: { use: { hideSelectedItem: () => false } },
}));
vi.mock("~/app/_components/map/use-selected-item", () => ({
  useSelectedItem: () => h.selectedItem.current,
}));
vi.mock("~/app/_components/map/selected-item", () => ({
  SelectedItem: () => <div data-testid="selected-item" />,
}));

import SelectedItemWrapper from "~/app/_components/map/desktop-selected-item";

describe("SelectedItemWrapper (desktop)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.query.mockReset();
    h.mapEvent.current = "idle";
    h.selectedItem.current = {
      selectedLocation: { id: 7 },
      selectedEvent: { id: 3 },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefetches the selected location's workouts and swallows prefetch errors", async () => {
    const failed = Promise.reject(new Error("offline"));
    const catchSpy = vi.spyOn(failed, "catch");
    h.query.mockReturnValue(failed);

    render(<SelectedItemWrapper />);

    expect(h.query).toHaveBeenCalledWith({
      queryKey: { input: { locationId: 7 } },
    });
    expect(catchSpy).toHaveBeenCalledOnce();
    await expect(catchSpy.mock.results[0]?.value).resolves.toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SELECTED_ITEM_DEBOUNCE_TIME_MS);
    });
    expect(screen.getByTestId("selected-item")).toBeInTheDocument();
  });

  it("neither prefetches nor renders while the map is moving", () => {
    h.mapEvent.current = "drag";

    render(<SelectedItemWrapper />);

    expect(h.query).not.toHaveBeenCalled();
    expect(screen.queryByTestId("selected-item")).toBeNull();
  });
});
