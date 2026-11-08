import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ComboboxModule from "@acme/ui/virtualized-combobox";

import type { RouterOutputs } from "~/orpc/types";
import { AOSFilter } from "./ao-filter";

type AO = RouterOutputs["org"]["all"]["orgs"][number];

const mocks = vi.hoisted(() => ({
  all: vi.fn<(input: unknown) => Promise<unknown>>(),
  realCombobox: false,
}));

vi.mock("~/orpc/client", () => ({
  client: { org: { all: (input: unknown) => mocks.all(input) } },
}));

// Popover layout/virtualization are browser concerns not worth exercising in
// jsdom -- a native select covers the same options/onSelect contract. Tests
// that set `realCombobox` render the real one to read its collapsed trigger.
vi.mock("@acme/ui/virtualized-combobox", async () => {
  const actual = await vi.importActual<typeof ComboboxModule>(
    "@acme/ui/virtualized-combobox",
  );
  return {
    VirtualizedCombobox: (
      props: Parameters<typeof actual.VirtualizedCombobox>[0],
    ) =>
      mocks.realCombobox ? (
        <actual.VirtualizedCombobox {...props} />
      ) : (
        <select
          aria-label="AO"
          onChange={(event) => props.onSelect?.(event.target.value)}
        >
          <option value="" />
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ),
  };
});

function renderFilter(onAoSelect = vi.fn(), selectedAos: AO[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AOSFilter onAoSelect={onAoSelect} selectedAos={selectedAos} />
    </QueryClientProvider>,
  );
  return { onAoSelect };
}

describe("AOSFilter", () => {
  beforeEach(() => {
    mocks.all.mockReset();
    mocks.realCombobox = false;
  });

  afterEach(cleanup);

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

  // Depot and The Depot each exist in more than one region, and Wichita has
  // two AOs named Depot.
  const depotAos = [
    { id: 11, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
    { id: 12, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
    { id: 21, name: "Depot", parentId: 2, parentOrgName: "Omaha" },
    { id: 31, name: "The Depot", parentId: 3, parentOrgName: "Tulsa" },
    { id: 41, name: "The Depot", parentId: 4, parentOrgName: "Boise" },
  ].map((ao) => ({ ...ao, orgType: "ao", parentOrgType: "region" }));

  it("labels repeated AO names with their region, and with the ID within one region", async () => {
    mocks.all.mockResolvedValue({ orgs: depotAos, total: depotAos.length });
    renderFilter();

    await screen.findByText("Depot · Omaha");
    const options = screen.getAllByRole("option");
    expect(
      options.map((option) => [
        option.getAttribute("value"),
        option.textContent,
      ]),
    ).toEqual([
      ["", ""],
      ["21", "Depot · Omaha"],
      ["11", "Depot · Wichita · ID 11"],
      ["12", "Depot · Wichita · ID 12"],
      ["41", "The Depot · Boise"],
      ["31", "The Depot · Tulsa"],
    ]);
  });

  it("selects the AO by ID when names and regions repeat", async () => {
    mocks.all.mockResolvedValue({ orgs: depotAos, total: depotAos.length });
    const { onAoSelect } = renderFilter();

    await screen.findByText("Depot · Wichita · ID 12");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "12" },
    });

    expect(onAoSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12, name: "Depot" }),
    );
  });

  it("omits the region when every AO shares one, and matches repeated names case-insensitively", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        { id: 11, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
        { id: 12, name: "DEPOT", parentId: 1, parentOrgName: "Wichita" },
        { id: 13, name: "Hornet", parentId: 1, parentOrgName: "Wichita" },
      ],
      total: 3,
    });
    renderFilter();

    await screen.findByText("Hornet");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["", "Depot · ID 11", "DEPOT · ID 12", "Hornet"]);
  });

  it("treats names that differ only by surrounding whitespace as repeats", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        { id: 11, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
        { id: 12, name: "Depot ", parentId: 1, parentOrgName: "Wichita" },
      ],
      total: 2,
    });
    renderFilter();

    await screen.findByText("Depot · ID 11");
    expect(
      Object.fromEntries(
        screen
          .getAllByRole("option")
          .map((option) => [option.getAttribute("value"), option.textContent]),
      ),
    ).toEqual({ "": "", "11": "Depot · ID 11", "12": "Depot · ID 12" });
  });

  it("sorts IDs in labels as numbers", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        { id: 100, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
        { id: 12, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
      ],
      total: 2,
    });
    renderFilter();

    await screen.findByText("Depot · ID 12");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["", "Depot · ID 12", "Depot · ID 100"]);
  });

  it("adds the ID when different parents share a name", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        { id: 11, name: "Depot", parentId: 1, parentOrgName: "Wichita" },
        { id: 51, name: "Depot", parentId: 5, parentOrgName: "Wichita" },
        { id: 21, name: "Depot", parentId: 2, parentOrgName: "Omaha" },
      ],
      total: 3,
    });
    const { onAoSelect } = renderFilter();

    await screen.findByText("Depot · Wichita · ID 51");
    expect(
      screen
        .getAllByRole("option")
        .map((option) => [option.getAttribute("value"), option.textContent]),
    ).toEqual([
      ["", ""],
      ["21", "Depot · Omaha"],
      ["11", "Depot · Wichita · ID 11"],
      ["51", "Depot · Wichita · ID 51"],
    ]);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "51" },
    });
    expect(onAoSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 51, parentId: 5 }),
    );
  });

  it("adds the ID when same-named AOs have no parent name", async () => {
    mocks.all.mockResolvedValue({
      orgs: [
        { id: 11, name: "Depot", parentId: 1, parentOrgName: null },
        { id: 21, name: "Depot", parentId: 2, parentOrgName: null },
      ],
      total: 2,
    });
    renderFilter();

    await screen.findByText("Depot · ID 11");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["", "Depot · ID 11", "Depot · ID 21"]);
  });

  it("keeps the region and ID in the collapsed selected value", async () => {
    mocks.realCombobox = true;
    mocks.all.mockResolvedValue({ orgs: depotAos, total: depotAos.length });
    renderFilter(vi.fn(), [depotAos[1] as unknown as AO]);

    const trigger = await screen.findByRole("combobox");
    await vi.waitFor(() => {
      expect(trigger.textContent).toBe("Depot · Wichita · ID 12");
    });
  });
});
