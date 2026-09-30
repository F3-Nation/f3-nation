import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AOSFilter } from "./ao-filter";

const mocks = vi.hoisted(() => ({
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: unknown) => mocks.all(input) } },
}));

// Popover layout/virtualization are browser concerns not worth exercising in
// jsdom -- a native select covers the same options/onSelect contract.
vi.mock("@acme/ui/virtualized-combobox", () => ({
  VirtualizedCombobox: ({
    options,
    onSelect,
  }: {
    options: { value: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <select aria-label="AO" onChange={(event) => onSelect(event.target.value)}>
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

function renderFilter(onAoSelect = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AOSFilter onAoSelect={onAoSelect} selectedAos={[]} />
    </QueryClientProvider>,
  );
  return { onAoSelect };
}

describe("AOSFilter", () => {
  beforeEach(() => {
    mocks.all.mockReset();
  });

  it("fetches every AO page and renders the options sorted by name", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        { id: 2, name: "Zulu AO", orgType: "ao", parentId: 1 },
        { id: 1, name: "Alpha AO", orgType: "ao", parentId: 1 },
      ],
      total: 2,
    });
    renderFilter();

    await screen.findByText("Alpha AO");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "",
      "Alpha AO",
      "Zulu AO",
    ]);
    expect(mocks.all).toHaveBeenCalledWith({
      orgTypes: ["ao"],
      pageIndex: 0,
      pageSize: 100,
    });
  });

  it("calls onAoSelect with the matching org when an option is chosen", async () => {
    mocks.all.mockResolvedValue({
      orgs: [{ id: 1, name: "Alpha AO", orgType: "ao", parentId: 1 }],
      total: 1,
    });
    const { onAoSelect } = renderFilter();

    await screen.findByText("Alpha AO");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "1" },
    });

    expect(onAoSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: "Alpha AO" }),
    );
  });
});
