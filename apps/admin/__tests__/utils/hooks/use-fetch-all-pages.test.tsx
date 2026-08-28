import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getQueryClient } from "~/orpc/invalidate-queries";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

// getQueryClient() only returns a stable singleton in a browser-like
// environment (jsdom, per vitest.config.ts).
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useFetchAllPages", () => {
  beforeEach(() => {
    getQueryClient().clear();
  });

  it("stops after a single short page", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: 1 }, { id: 2 }],
      total: 2,
    });

    const { result } = renderHook(
      () =>
        useFetchAllPages({
          queryKey: ["single-page-test"],
          fetchPage,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ pageIndex: 0, pageSize: 100 });
    expect(result.current.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("pages through until every row has been fetched", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: fullPage, total: 101 })
      .mockResolvedValueOnce({ items: [{ id: 100 }], total: 101 });

    const { result } = renderHook(
      () =>
        useFetchAllPages({
          queryKey: ["multi-page-test"],
          fetchPage,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      pageIndex: 0,
      pageSize: 100,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      pageIndex: 1,
      pageSize: 100,
    });
    expect(result.current.data).toHaveLength(101);
  });

  it("does not fetch when disabled", () => {
    const fetchPage = vi.fn();

    renderHook(
      () =>
        useFetchAllPages({
          queryKey: ["disabled-test"],
          fetchPage,
          enabled: false,
        }),
      { wrapper: Wrapper },
    );

    expect(fetchPage).not.toHaveBeenCalled();
  });
});
