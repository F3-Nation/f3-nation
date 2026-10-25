import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegionFilter } from "./region-filter";

const mocks = vi.hoisted(() => ({
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: unknown) => mocks.all(input) } },
}));

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

const alpha = { id: 1, name: "Alpha Region", orgType: "region", parentId: 9 };
const beta = { id: 2, name: "Beta Region", orgType: "region", parentId: 9 };

type Region = Parameters<typeof RegionFilter>[0]["selectedRegions"][number];
const asRegion = (region: typeof alpha) => region as unknown as Region;

const renderFilter = (selectedRegions: (typeof alpha)[]) => {
  const onRegionSelect = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RegionFilter
        onRegionSelect={onRegionSelect}
        selectedRegions={selectedRegions.map(asRegion)}
      />
    </QueryClientProvider>,
  );
  return { onRegionSelect };
};

describe("RegionFilter", () => {
  beforeEach(() => {
    mocks.all.mockReset();
    mocks.all.mockResolvedValue({ orgs: [alpha, beta], total: 2 });
  });
  afterEach(cleanup);

  it("labels the filter by selection count", () => {
    renderFilter([]);
    expect(screen.getByRole("combobox").textContent).toBe("Filter by region");
    cleanup();

    renderFilter([alpha]);
    expect(screen.getByRole("combobox").textContent).toBe("1 region selected");
    cleanup();

    renderFilter([alpha, beta]);
    expect(screen.getByRole("combobox").textContent).toBe("2 regions selected");
  });

  it("loads every region and selects the one that is picked", async () => {
    const { onRegionSelect } = renderFilter([]);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Beta Region"));

    expect(mocks.all).toHaveBeenCalledWith(
      expect.objectContaining({ orgTypes: ["region"], pageIndex: 0 }),
    );
    expect(onRegionSelect).toHaveBeenCalledWith(beta);
  });
});
