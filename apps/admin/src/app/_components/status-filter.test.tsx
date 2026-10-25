import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IsActiveStatus } from "@acme/shared/app/enums";

import { StatusFilter } from "./status-filter";

// cmdk measures and scrolls with browser APIs jsdom does not implement.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const renderFilter = (
  selectedStatuses: IsActiveStatus[],
  onlyMine: boolean,
) => {
  const handlers = {
    setSelectedStatuses: vi.fn(),
    setOnlyMine: vi.fn(),
    resetPage: vi.fn(),
  };
  render(
    <StatusFilter
      selectedStatuses={selectedStatuses}
      onlyMine={onlyMine}
      {...handlers}
    />,
  );
  return handlers;
};

describe("StatusFilter", () => {
  it("shows a badge only for each active filter", () => {
    renderFilter(["active"], false);

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Inactive")).toBeNull();
    expect(screen.queryByText("Only Mine")).toBeNull();
  });

  it.each([
    ["Active", ["active", "inactive"], ["inactive"]],
    ["Inactive", ["active", "inactive"], ["active"]],
  ] as const)(
    "removes the %s status when its badge is clicked",
    (label, selected, remaining) => {
      const { setSelectedStatuses, resetPage } = renderFilter(
        [...selected],
        false,
      );

      fireEvent.click(screen.getByText(label));

      expect(setSelectedStatuses).toHaveBeenCalledWith(remaining);
      expect(resetPage).toHaveBeenCalledTimes(1);
    },
  );

  it("clears Only Mine when its badge is clicked", () => {
    const { setOnlyMine, resetPage } = renderFilter(["active"], true);

    fireEvent.click(screen.getByText("Only Mine"));

    expect(setOnlyMine).toHaveBeenCalledWith(false);
    expect(resetPage).toHaveBeenCalledTimes(1);
  });

  it("toggles statuses and Only Mine from the menu", () => {
    const { setSelectedStatuses, setOnlyMine, resetPage } = renderFilter(
      ["active"],
      false,
    );

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("Inactive"));
    expect(setSelectedStatuses).toHaveBeenLastCalledWith([
      "active",
      "inactive",
    ]);

    fireEvent.click(screen.getByRole("option", { name: "Active" }));
    expect(setSelectedStatuses).toHaveBeenLastCalledWith([]);

    fireEvent.click(screen.getByText("Only Mine"));
    expect(setOnlyMine).toHaveBeenCalledWith(true);
    expect(resetPage).toHaveBeenCalledTimes(3);
  });
});
