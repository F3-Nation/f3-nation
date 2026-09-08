// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { SearchBox } from "./search-box";
import type { Org } from "../_lib/types";

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
    render(<SearchBox getResults={getResults} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Char" },
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByText("Charlotte")).toBeTruthy();
    expect(screen.getByText("Charleston")).toBeTruthy();
  });

  it("shows the no-match state for a nonempty query with no hits", () => {
    render(<SearchBox getResults={getResults} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("selects a result, calls onSelect, and keeps the list closed", () => {
    const onSelect = vi.fn();
    render(<SearchBox getResults={getResults} onSelect={onSelect} />);
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
    render(<SearchBox getResults={getResults} onSelect={onSelect} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(orgs[0]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the list on Escape", () => {
    render(<SearchBox getResults={getResults} onSelect={vi.fn()} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears results and closes when the query is emptied", () => {
    render(<SearchBox getResults={getResults} onSelect={vi.fn()} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Char" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
