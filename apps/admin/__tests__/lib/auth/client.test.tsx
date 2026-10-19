import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider, useAdminSession } from "~/lib/auth/client";

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
});
