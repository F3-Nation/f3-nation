// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { SearchBox } from "./search-box";
import type { Org } from "../_lib/types";

// Stub the debounced AO hook so these tests stay synchronous: it returns a
// canned AO only for queries containing "boot", a simulated fetch failure for
// queries containing "err", and nothing otherwise.
vi.mock("../_lib/use-ao-search", () => ({
  useAoSearch: (q: string) => {
    const query = q.toLowerCase();
    if (query.includes("err")) {
      return { results: [], loading: false, error: true };
    }
    if (query.includes("boot")) {
      return {
        results: [
          {
            id: 99,
            name: "Bootcamp",
            regionId: 10,
            regionName: "Charlotte",
            locationId: 5,
            latitude: 1,
            longitude: 2,
            eventCount: 3,
          },
        ],
        loading: false,
        error: false,
      };
    }
    return { results: [], loading: false, error: false };
  },
}));

const orgs: Org[] = [
  { id: 1, parentId: null, name: "Charlotte", orgType: "region" },
  { id: 2, parentId: null, name: "Charleston", orgType: "region" },
];

function getResults(query: string): Org[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return orgs.filter((o) => o.name.toLowerCase().includes(q));
}

afterEach(() => {
  cleanup();
});

describe("SearchBox", () => {
  it("opens the result list and renders matches as the query changes", () => {
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Char" },
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByText("Charlotte")).toBeTruthy();
    expect(screen.getByText("Charleston")).toBeTruthy();
  });

  it("shows the no-match state for a nonempty query with no hits", () => {
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("selects a result, calls onSelect, and keeps the list closed", () => {
    const onSelect = vi.fn();
    render(
      <SearchBox
        getResults={getResults}
        onSelect={onSelect}
        onSelectAo={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });

    fireEvent.click(screen.getByText("Charlotte"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(orgs[0]);
    // The setQuery(name) from selecting must not reopen the dropdown.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("selects the top match on Enter and keeps the list closed", () => {
    const onSelect = vi.fn();
    render(
      <SearchBox
        getResults={getResults}
        onSelect={onSelect}
        onSelectAo={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(orgs[0]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the list on Escape", () => {
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears results and closes when the query is emptied", () => {
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not reopen a stale partial-query list after select then refocus", () => {
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });
    // Both Charlotte and Charleston match the partial query.
    expect(screen.getByText("Charleston")).toBeTruthy();

    fireEvent.click(screen.getByText("Charlotte"));
    expect(screen.queryByRole("listbox")).toBeNull();

    // Refocusing opens the list for the current (full-name) query only, not the
    // stale partial-query matches.
    fireEvent.focus(input);
    expect(screen.getByText("Charlotte")).toBeTruthy();
    expect(screen.queryByText("Charleston")).toBeNull();
  });

  it("renders AO hits with their region and calls onSelectAo on choose", () => {
    const onSelectAo = vi.fn(() => true);
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={onSelectAo}
      />,
    );
    // "boot" matches no org but the stubbed AO hook returns Bootcamp.
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "boot" },
    });
    expect(screen.getByText("Bootcamp")).toBeTruthy();
    // Region name is shown as the AO's subtitle.
    expect(screen.getByText("Charlotte")).toBeTruthy();

    fireEvent.click(screen.getByText("Bootcamp"));
    expect(onSelectAo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects the first AO on Enter when no org matches", () => {
    const onSelectAo = vi.fn(() => true);
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={onSelectAo}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "boot" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectAo).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback message when an AO's region can't be located on the map", () => {
    const onSelectAo = vi.fn(() => false);
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={onSelectAo}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "boot" },
    });
    fireEvent.click(screen.getByText("Bootcamp"));
    expect(screen.getByText("Couldn't locate that AO on the map")).toBeTruthy();
  });

  it("shows a search-unavailable message when the AO search fails", () => {
    render(
      <SearchBox
        getResults={getResults}
        onSelect={vi.fn()}
        onSelectAo={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "error-query" },
    });
    expect(screen.getByText("Search unavailable — try again")).toBeTruthy();
  });
});
