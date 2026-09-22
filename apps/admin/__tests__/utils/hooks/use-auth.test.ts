import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAuth } from "~/utils/hooks/use-auth";

interface MockSession {
  roles?: { roleName: string; orgId: number; orgName: string }[];
}

const { useAdminSessionMock } = vi.hoisted(() => ({
  useAdminSessionMock:
    vi.fn<() => { data: MockSession | null; status: string }>(),
}));

vi.mock("~/lib/auth/client", () => ({
  useAdminSession: useAdminSessionMock,
}));

describe("useAuth", () => {
  it("reports no privileges when there is no session", () => {
    useAdminSessionMock.mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({
      isNationAdmin: false,
      isEditorOrAdmin: false,
      isAdmin: false,
      status: "unauthenticated",
    });
  });

  it("reports no privileges for a session without roles", () => {
    useAdminSessionMock.mockReturnValue({
      data: {},
      status: "authenticated",
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({
      isNationAdmin: false,
      isEditorOrAdmin: false,
      isAdmin: false,
    });
  });

  it("treats an editor as editor-or-admin but not admin", () => {
    useAdminSessionMock.mockReturnValue({
      data: {
        roles: [{ roleName: "editor", orgId: 2, orgName: "F3 Region" }],
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({
      isNationAdmin: false,
      isEditorOrAdmin: true,
      isAdmin: false,
    });
  });

  it("treats a regional admin as admin but not nation admin", () => {
    useAdminSessionMock.mockReturnValue({
      data: {
        roles: [{ roleName: "admin", orgId: 2, orgName: "F3 Region" }],
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({
      isNationAdmin: false,
      isEditorOrAdmin: true,
      isAdmin: true,
    });
  });

  it("flags a nation admin when the admin role is on the F3 Nation org", () => {
    useAdminSessionMock.mockReturnValue({
      data: {
        roles: [{ roleName: "admin", orgId: 1, orgName: "F3 Nation" }],
      },
      status: "authenticated",
    });

    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({
      isNationAdmin: true,
      isEditorOrAdmin: true,
      isAdmin: true,
    });
  });
});
