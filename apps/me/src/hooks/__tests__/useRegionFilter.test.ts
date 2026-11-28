import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRegionFilter } from "../useRegionFilter";
import type { Region } from "@/lib/types";

const regions: Region[] = [
  { id: 1, name: "Muletown", isActive: true },
  { id: 2, name: "Gotham", isActive: true },
  { id: 3, name: "Old Town", isActive: false },
];

describe("useRegionFilter", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists only active regions when nothing is selected", () => {
    const { result } = renderHook(() =>
      useRegionFilter({ regions, selectedId: null, search: "" }),
    );

    expect(result.current.selectedRegion).toBeUndefined();
    expect(result.current.filteredRegions.map((r) => r.id)).toEqual([1, 2]);
  });

  it("keeps an inactive region in the list while it is the selected one", () => {
    const { result } = renderHook(() =>
      useRegionFilter({ regions, selectedId: 3, search: "" }),
    );

    expect(result.current.selectedRegion).toEqual(regions[2]);
    expect(result.current.filteredRegions.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("matches the search case-insensitively against region names", () => {
    const { result } = renderHook(() =>
      useRegionFilter({ regions, selectedId: 3, search: "TOWN" }),
    );

    expect(result.current.filteredRegions.map((r) => r.id)).toEqual([1, 3]);
  });

  it("excludes an inactive region that is not selected, even when it matches the search", () => {
    const { result } = renderHook(() =>
      useRegionFilter({ regions, selectedId: 1, search: "old" }),
    );

    expect(result.current.selectedRegion).toEqual(regions[0]);
    expect(result.current.filteredRegions).toEqual([]);
  });

  it("returns no selected region for an id that is not in the list", () => {
    const { result } = renderHook(() =>
      useRegionFilter({ regions, selectedId: 99, search: "" }),
    );

    expect(result.current.selectedRegion).toBeUndefined();
    expect(result.current.filteredRegions.map((r) => r.id)).toEqual([1, 2]);
  });
});
