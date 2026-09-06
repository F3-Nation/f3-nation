import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebounce } from "~/utils/hooks/use-debounce";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 200));
    expect(result.current).toBe("initial");
  });

  it("only exposes a new value after the delay has elapsed", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: "first" } },
    );

    rerender({ value: "second" });
    expect(result.current).toBe("first");

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe("first");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("second");
  });

  it("discards intermediate values that change within the delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: "first" } },
    );

    rerender({ value: "second" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: "third" });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe("third");
  });
});
