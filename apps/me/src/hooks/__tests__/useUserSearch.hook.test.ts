import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserSearch } from "../useUserSearch";
import type { UserListItem } from "@/lib/types";

function makeUser(id: number, f3Name: string): UserListItem {
  return {
    id,
    f3Name,
    homeRegionId: 1,
    homeRegionName: "Muletown",
    status: "active",
  };
}

const fetchMock = vi.fn();

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function respondWith(users: UserListItem[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ users }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useUserSearch search state", () => {
  it("loads results after the debounce and clears them when the dropdown closes", async () => {
    respondWith([makeUser(1, "Dredd")]);
    const { result, rerender } = renderHook(
      (props: { open: boolean; search: string }) =>
        useUserSearch({ value: null, ...props }),
      { initialProps: { open: true, search: "dr" } },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.results).toHaveLength(1);
    expect(result.current.loading).toBe(false);

    rerender({ open: false, search: "dr" });
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("clears results when the query becomes shorter than the minimum", async () => {
    respondWith([makeUser(1, "Dredd")]);
    const { result, rerender } = renderHook(
      (props: { open: boolean; search: string }) =>
        useUserSearch({ value: null, ...props }),
      { initialProps: { open: true, search: "dr" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.results).toHaveLength(1);

    rerender({ open: true, search: "d" });
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  describe.each([
    ["the dropdown closes", { open: false, search: "dr" }],
    ["the query drops below the minimum length", { open: true, search: "d" }],
  ])("when %s while a request is in flight", (_label, nextProps) => {
    it("clears loading, aborts the request and ignores its late response", async () => {
      let resolveFetch: (value: unknown) => void = () => undefined;
      let requestSignal: AbortSignal | undefined;
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      });
      const { result, rerender } = renderHook(
        (props: { open: boolean; search: string }) =>
          useUserSearch({ value: null, ...props }),
        { initialProps: { open: true, search: "dr" } },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(true);
      expect(requestSignal?.aborted).toBe(false);

      rerender(nextProps);
      expect(result.current.loading).toBe(false);
      expect(result.current.results).toEqual([]);
      expect(requestSignal?.aborted).toBe(true);

      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ users: [makeUser(1, "Dredd")] }),
      });
      await flush();
      expect(result.current.results).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });

  it("does not fetch while closed", async () => {
    const { result } = renderHook(() =>
      useUserSearch({ value: null, open: false, search: "dredd" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });
});

describe("useUserSearch selectedUser", () => {
  it("resolves the selected user from `value` and drops it when value changes or clears", async () => {
    fetchMock.mockImplementation((url: string) => {
      const id = Number(new URL(url, "http://x").searchParams.get("userId"));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ users: [makeUser(id, `User${id}`)] }),
      });
    });
    const { result, rerender } = renderHook<
      ReturnType<typeof useUserSearch>,
      { value: number | null }
    >((props) => useUserSearch({ ...props, open: false, search: "" }), {
      initialProps: { value: 5 },
    });

    await flush();
    expect(result.current.selectedUser?.id).toBe(5);

    rerender({ value: 7 });
    expect(result.current.selectedUser).toBeNull();
    await flush();
    expect(result.current.selectedUser?.id).toBe(7);

    rerender({ value: null });
    expect(result.current.selectedUser).toBeNull();
  });

  it("keeps a user set through setSelectedUser while value matches", () => {
    const user = makeUser(3, "Tclaps");
    const { result, rerender } = renderHook<
      ReturnType<typeof useUserSearch>,
      { value: number | null }
    >((props) => useUserSearch({ ...props, open: false, search: "" }), {
      initialProps: { value: 3 },
    });
    act(() => result.current.setSelectedUser(user));
    expect(result.current.selectedUser).toEqual(user);

    rerender({ value: 4 });
    expect(result.current.selectedUser).toBeNull();
  });

  it("re-resolves A when the parent restores it after B was picked via setSelectedUser", async () => {
    const userA = makeUser(5, "Alpha");
    const userB = makeUser(7, "Bravo");
    fetchMock.mockImplementation((url: string) => {
      const id = Number(new URL(url, "http://x").searchParams.get("userId"));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ users: [id === 5 ? userA : userB] }),
      });
    });
    const { result, rerender } = renderHook<
      ReturnType<typeof useUserSearch>,
      { value: number | null }
    >((props) => useUserSearch({ ...props, open: false, search: "" }), {
      initialProps: { value: 5 },
    });

    await flush();
    expect(result.current.selectedUser).toEqual(userA);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // User picks B from the dropdown: parent sets value, hook gets the user.
    // (value change and setSelectedUser land in the same batch, as in the
    // UserSelect click handler).
    act(() => {
      rerender({ value: 7 });
      result.current.setSelectedUser(userB);
    });
    await flush();
    expect(result.current.selectedUser).toEqual(userB);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Parent restores A (e.g. form reset) without calling setSelectedUser.
    rerender({ value: 5 });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.selectedUser).toEqual(userA);
  });

  it("does not refetch in a loop after a failed fetch for the same value", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    const { result, rerender } = renderHook<
      ReturnType<typeof useUserSearch>,
      { value: number | null; open: boolean }
    >((props) => useUserSearch({ ...props, search: "" }), {
      initialProps: { value: 5, open: false },
    });

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.selectedUser).toBeNull();

    rerender({ value: 5, open: true });
    rerender({ value: 5, open: false });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.selectedUser).toBeNull();
  });
});
