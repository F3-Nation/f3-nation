import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useOptions } from "~/utils/use-options";

interface Item {
  id: number;
  name: string;
}

const label = (item: Item) => item.name;
const value = (item: Item) => String(item.id);

describe("useOptions", () => {
  it("maps items to label/value options sorted by label", () => {
    const data: Item[] = [
      { id: 2, name: "Charlie" },
      { id: 1, name: "alpha" },
      { id: 3, name: "Bravo" },
    ];

    const { result } = renderHook(() => useOptions(data, label, value));

    expect(result.current).toEqual([
      { label: "alpha", value: "1" },
      { label: "Bravo", value: "3" },
      { label: "Charlie", value: "2" },
    ]);
  });

  it("returns an empty array when data is undefined", () => {
    const { result } = renderHook(() =>
      useOptions<Item>(undefined, label, value),
    );

    expect(result.current).toEqual([]);
  });

  it("keeps the same array across renders while data is unchanged", () => {
    const data: Item[] = [{ id: 1, name: "alpha" }];
    const { result, rerender } = renderHook(() =>
      useOptions(data, label, value),
    );
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
