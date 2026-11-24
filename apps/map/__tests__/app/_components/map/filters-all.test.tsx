import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/orpc/client", () => ({ client: { eventType: { all: vi.fn() } } }));
vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: () => ({
    data: [
      { id: 1, name: "Bootcamp" },
      { id: 2, name: "Ruck" },
    ],
    isLoading: false,
  }),
}));
vi.mock("~/app/_components/map/filtered-map-results-provider", () => ({
  useFilteredMapResults: () => ({
    filteredLocationMarkers: [{ events: [{}, {}] }, { events: [{}] }],
  }),
}));

import { FiltersAll } from "~/app/_components/map/filters-all";
import { FiltersButton } from "~/app/_components/map/filters-button";
import { filterStore, initialFilterState } from "~/utils/store/filter";

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("FiltersAll", () => {
  beforeEach(() => {
    filterStore.setState({ ...initialFilterState, allFilters: true });
  });

  it("treats Morning and Evening as one choice", () => {
    render(<FiltersAll />);
    expect(pressed("Any time")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Morning" }));
    expect(filterStore.getState()).toMatchObject({ am: true, pm: false });

    fireEvent.click(screen.getByRole("button", { name: "Evening" }));
    expect(filterStore.getState()).toMatchObject({ am: false, pm: true });
    expect(pressed("Morning")).toBe("false");
    expect(pressed("Evening")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Any time" }));
    expect(filterStore.getState()).toMatchObject({ am: false, pm: false });
  });

  it("toggles This weekend, days and types", () => {
    render(<FiltersAll />);
    fireEvent.click(screen.getByRole("button", { name: "This weekend" }));
    fireEvent.click(screen.getByRole("button", { name: "Tuesday" }));
    fireEvent.click(screen.getByRole("button", { name: "Ruck" }));
    expect(filterStore.getState()).toMatchObject({
      weekend: true,
      dayTu: true,
      nationalEventTypeIds: [2],
    });

    fireEvent.click(screen.getByRole("button", { name: "Ruck" }));
    expect(filterStore.get("nationalEventTypeIds")).toEqual([]);
  });

  it("shows the matching workout count and closes on it", () => {
    render(<FiltersAll />);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 workouts" }));
    expect(filterStore.get("allFilters")).toBe(false);
  });

  it("resets every filter", () => {
    filterStore.setState({ weekend: true, am: true, dayM: true });
    render(<FiltersAll />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(filterStore.getState()).toMatchObject(initialFilterState);
  });
});

describe("FiltersButton", () => {
  beforeEach(() => {
    filterStore.setState(initialFilterState);
  });

  it("opens the filters and shows how many groups are active", () => {
    filterStore.setState({ dayTu: true, am: true });
    render(<FiltersButton />);
    const button = screen.getByRole("button", { name: "Filters · 2" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(filterStore.get("allFilters")).toBe(true);
  });

  it("has no count when nothing is filtered", () => {
    render(<FiltersButton />);
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
  });
});
