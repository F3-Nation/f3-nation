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
});
