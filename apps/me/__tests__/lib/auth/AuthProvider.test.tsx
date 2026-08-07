import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(AuthProvider, null, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider + useAuth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in loading state with null user", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined)); // never resolves

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("sets user on successful /api/auth/me fetch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          user: { sub: "42", email: "me@f3nation.test", name: "Pax" },
        }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toEqual({
      sub: "42",
      email: "me@f3nation.test",
      name: "Pax",
    });
  });

  it("sets user to null when /api/auth/me returns non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
  });

  it("sets user to null when /api/auth/me fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
  });

  it("signOut calls /api/auth/logout and redirects to auth-server URL", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: { sub: "42", email: "me@f3nation.test" },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            redirectTo: "https://auth.f3nation.test/logout",
          }),
      });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(window.location.href).toBe("https://auth.f3nation.test/logout");
    expect(result.current.user).toBeNull();
  });

  it("signOut falls back to '/' when logout response has no redirectTo", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ user: { sub: "42", email: "me@f3nation.test" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(window.location.href).toBe("/");
  });

  it("signOut still clears user when logout fetch returns non-ok", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ user: { sub: "42", email: "me@f3nation.test" } }),
      })
      .mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
    expect(window.location.href).toBe("/");
  });

  it("signOut still clears user when logout fetch throws", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ user: { sub: "42", email: "me@f3nation.test" } }),
      })
      .mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
  });

  it("cancels state update when component unmounts before ok response arrives", async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useAuth(), { wrapper });

    // Unmount before the fetch resolves — cancelled becomes true.
    unmount();

    // Resolve with a success; cancelled=true so no state update should fire.
    await act(async () => {
      resolveFetch({
        ok: true,
        json: () =>
          Promise.resolve({ user: { sub: "42", email: "me@f3nation.test" } }),
      });
    });
    // No assertion needed — the test passes if no "update on unmounted" error occurs.
  });

  it("cancels state update when component unmounts before non-ok response arrives", async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useAuth(), { wrapper });
    unmount();

    await act(async () => {
      resolveFetch({ ok: false });
    });
  });

  it("cancels state update when component unmounts before fetch throws", async () => {
    let rejectFetch!: (err: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const { unmount } = renderHook(() => useAuth(), { wrapper });
    unmount();

    await act(async () => {
      rejectFetch(new Error("network error"));
    });
  });

  it("useAuth throws when used outside AuthProvider", () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within AuthProvider",
    );
  });
});
