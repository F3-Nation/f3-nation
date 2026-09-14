// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchAosMock = vi.fn();
vi.mock("./api", () => ({
  searchAos: (q: string, signal?: AbortSignal): Promise<unknown> =>
    searchAosMock(q, signal) as Promise<unknown>,
}));

import { useAoSearch } from "./use-ao-search";

const hit = {
  id: 1,
  name: "Bootcamp",
  regionId: 10,
  regionName: "Charlotte",
  locationId: 5,
  latitude: 1,
  longitude: 2,
  eventCount: 3,
};

describe("useAoSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchAosMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not search for queries shorter than 2 characters", () => {
    const { result } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "a" },
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(searchAosMock).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("debounces, then returns results for a valid query", async () => {
    searchAosMock.mockResolvedValue([hit]);
    const { result } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "boot" },
    });

    // Nothing fires before the debounce window elapses.
    expect(searchAosMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(searchAosMock).toHaveBeenCalledWith("boot", expect.any(AbortSignal));
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]?.name).toBe("Bootcamp");
  });

  it("clears results when the search fails", async () => {
    searchAosMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "boot" },
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("cancels a superseded query without firing the old request", () => {
    searchAosMock.mockResolvedValue([hit]);
    const { rerender } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "boo" },
    });
    // Change the query before the debounce elapses; the first timer is cleared.
    rerender({ q: "boot" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Only the latest query is searched, exactly once.
    expect(searchAosMock).toHaveBeenCalledTimes(1);
    expect(searchAosMock).toHaveBeenCalledWith("boot", expect.any(AbortSignal));
  });

  it("ignores a result that resolves after its request was superseded", async () => {
    const deferred: ((v: unknown) => void)[] = [];
    searchAosMock.mockImplementation(
      () => new Promise((resolve) => deferred.push(resolve)),
    );
    const { result, rerender } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "boot" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Supersede: a second query starts a second in-flight request.
    rerender({ q: "booted" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Resolving the first (aborted) request must not populate results.
    await act(async () => {
      deferred[0]?.([hit]);
    });
    expect(result.current.results).toEqual([]);
    // Resolving the current request does.
    await act(async () => {
      deferred[1]?.([hit]);
    });
    expect(result.current.results).toHaveLength(1);
  });

  it("ignores a rejection from a superseded request", async () => {
    const deferred: ((reason: unknown) => void)[] = [];
    searchAosMock.mockImplementation(
      () => new Promise((_resolve, reject) => deferred.push(reject)),
    );
    const { result, rerender } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "boot" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender({ q: "booted" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Rejecting the first (superseded/aborted) request is swallowed.
    await act(async () => {
      deferred[0]?.(new Error("boom"));
    });
    expect(result.current.results).toEqual([]);
  });

  it("clears previously loaded results immediately when query changes", async () => {
    searchAosMock.mockResolvedValueOnce([hit]).mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(({ q }) => useAoSearch(q), {
      initialProps: { q: "boot" },
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.results).toHaveLength(1);

    rerender({ q: "zz" });
    expect(result.current.results).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(searchAosMock).toHaveBeenLastCalledWith(
      "zz",
      expect.any(AbortSignal),
    );
    expect(result.current.results).toEqual([]);
  });
});
