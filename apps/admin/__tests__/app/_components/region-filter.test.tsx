import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { RegionFilter } from "~/app/_components/region-filter";

// Radix's popper measures its trigger, and cmdk scrolls the active item into
// view; jsdom has neither ResizeObserver nor scrollIntoView.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        /* no-op */
      }
      unobserve() {
        /* no-op */
      }
      disconnect() {
        /* no-op */
      }
    },
  );
  Object.assign(Element.prototype, {
    scrollIntoView: () => {
      /* no-op */
    },
  });
});

const regions = [
  { id: 1, name: "Boone" },
  { id: 2, name: "Charlotte" },
];

vi.mock("~/orpc/react", () => ({
  orpc: { org: { all: { queryOptions: () => ({}) } } },
  useQuery: () => ({ data: { orgs: regions } }),
}));

type Props = Parameters<typeof RegionFilter>[0];

const renderFilter = (selectedRegions: Props["selectedRegions"] = []) => {
  const onRegionSelect = vi.fn();
  render(
    <RegionFilter
      onRegionSelect={onRegionSelect}
      selectedRegions={selectedRegions}
    />,
  );
  return { onRegionSelect };
};

const selected = (count: number) =>
  regions.slice(0, count) as unknown as Props["selectedRegions"];

describe("RegionFilter", () => {
  it("shows the placeholder when nothing is selected", () => {
    renderFilter();

    expect(screen.getByRole("combobox").textContent).toContain(
      "Filter by region",
    );
  });

  it("pluralizes the selected-region count", () => {
    const { unmount } = render(
      <RegionFilter onRegionSelect={vi.fn()} selectedRegions={selected(1)} />,
    );
    expect(screen.getByRole("combobox").textContent).toContain(
      "1 region selected",
    );
    unmount();

    renderFilter(selected(2));
    expect(screen.getByRole("combobox").textContent).toContain(
      "2 regions selected",
    );
  });

  it("calls onRegionSelect with the chosen region", () => {
    const { onRegionSelect } = renderFilter(selected(1));

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Charlotte"));

    expect(onRegionSelect).toHaveBeenCalledWith(regions[1]);
  });
});
