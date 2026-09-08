/**
 * The schedule-exception list decorates the map rather than supplying it, so
 * this hook is the one place that must not inherit the app-wide `throwOnError`
 * from `~/orpc/query-client` — under that default a 500 here throws during
 * render and replaces a working map with the global error page.
 *
 * Dropping the throw also drops `global-error.tsx`'s `captureException`, so the
 * hook owns the reporting instead. Both halves are pinned here.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  data?: unknown;
  isError?: boolean;
  error?: Error | null;
}

const { captureException, queryCalls, queryResult } = vi.hoisted(() => {
  const queryCalls: Record<string, unknown>[] = [];
  const queryResult: { current: QueryResult } = {
    current: { data: undefined, isError: false, error: null },
  };
  return { captureException: vi.fn(), queryCalls, queryResult };
});

vi.mock("@sentry/nextjs", () => ({ captureException }));

// `queryOptions` echoes its argument so the test can read exactly what the hook
// asked react-query for.
vi.mock("~/orpc/react", () => ({
  useQuery: (options: Record<string, unknown>) => {
    queryCalls.push(options);
    return queryResult.current;
  },
  orpc: {
    map: {
      location: {
        upcomingInstances: {
          queryOptions: (options: Record<string, unknown>) => options,
        },
      },
    },
  },
}));

import { useUpcomingInstances } from "~/utils/hooks/use-upcoming-instances";

describe("useUpcomingInstances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryCalls.length = 0;
    queryResult.current = { data: undefined, isError: false, error: null };
  });

  it("opts out of the app-wide throwOnError", () => {
    renderHook(() => useUpcomingInstances());

    expect(queryCalls[0]).toMatchObject({ throwOnError: false });
  });

  it("forwards a caller's enabled gate", () => {
    renderHook(() => useUpcomingInstances({ enabled: false }));

    expect(queryCalls[0]).toMatchObject({ enabled: false });
  });

  it("returns the instances and no failure when the query succeeds", () => {
    queryResult.current = { data: [{ id: 1 }], isError: false, error: null };

    const { result } = renderHook(() => useUpcomingInstances());

    expect(result.current).toEqual({
      instances: [{ id: 1 }],
      isUnavailable: false,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a failure as unavailable rather than as an empty list", () => {
    queryResult.current = {
      data: undefined,
      isError: true,
      error: new Error("500"),
    };

    const { result } = renderHook(() => useUpcomingInstances());

    expect(result.current.isUnavailable).toBe(true);
    expect(result.current.instances).toBeUndefined();
  });

  it("sends one Sentry report however many callers observe the same failure", () => {
    const error = new Error("500");
    queryResult.current = { data: undefined, isError: true, error };

    // Every caller shares one cache entry, so all of them see this same Error.
    renderHook(() => useUpcomingInstances());
    renderHook(() => useUpcomingInstances());
    renderHook(() => useUpcomingInstances());

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { event: "map.upcoming_instances.fetch_failed" },
    });
  });

  it("reports each distinct failure", () => {
    queryResult.current = {
      data: undefined,
      isError: true,
      error: new Error("first"),
    };
    renderHook(() => useUpcomingInstances());

    queryResult.current = {
      data: undefined,
      isError: true,
      error: new Error("second"),
    };
    renderHook(() => useUpcomingInstances());

    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
