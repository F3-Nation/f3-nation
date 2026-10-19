import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminSessionProvider,
  navigateToSsoLogin,
  navigateToSsoLogout,
  useAdminSession,
} from "~/lib/auth/client";

const renderSession = () =>
  renderHook(() => useAdminSession(), {
    wrapper: ({ children }) => (
      <AdminSessionProvider initialSession={null}>
        {children}
      </AdminSessionProvider>
    ),
  });

const stubMe = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }),
  );

describe("AdminSessionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills in empty roles when /api/auth/me omits them", async () => {
    stubMe({ user: { sub: "1", id: 1, email: "a@example.com" } });
    const { result } = renderSession();

    let fetched: Awaited<ReturnType<typeof result.current.update>> = null;
    await act(async () => {
      fetched = await result.current.update();
    });

    expect(fetched).toEqual({
      sub: "1",
      id: 1,
      email: "a@example.com",
      roles: [],
    });
    expect(result.current.status).toBe("authenticated");
  });

  it("is unauthenticated when /api/auth/me has no user", async () => {
    stubMe({ user: null });
    const { result } = renderSession();

    await act(async () => {
      await result.current.update();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
  });

  it("is unauthenticated when /api/auth/me fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderSession();

    await act(async () => {
      await result.current.update();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
  });

  it("merges a partial session and clears it on null", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderSession();

    await act(async () => {
      await result.current.update({ id: 1, email: "a@example.com" });
    });
    expect(result.current.data).toEqual({ id: 1, email: "a@example.com" });
    expect(result.current.status).toBe("authenticated");

    await act(async () => {
      await result.current.update({ email: "b@example.com" });
    });
    expect(result.current.data).toEqual({ id: 1, email: "b@example.com" });

    await act(async () => {
      await result.current.update(null);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useAdminSession", () => {
  it("throws outside AdminSessionProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(() => renderHook(() => useAdminSession())).toThrow(
      "useAdminSession must be used inside AdminSessionProvider",
    );
    consoleError.mockRestore();
  });
});

describe("SSO navigation", () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockClear();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends login to the SSO route with an encoded returnTo", () => {
    navigateToSsoLogin("/users?tab=all");
    expect(assign).toHaveBeenCalledWith(
      "/api/auth/login?returnTo=%2Fusers%3Ftab%3Dall",
    );
  });

  it("defaults login returnTo to the root", () => {
    navigateToSsoLogin();
    expect(assign).toHaveBeenCalledWith("/api/auth/login?returnTo=%2F");
  });

  it("sends logout to the SSO route", () => {
    navigateToSsoLogout();
    expect(assign).toHaveBeenCalledWith("/api/auth/logout");
  });
});
