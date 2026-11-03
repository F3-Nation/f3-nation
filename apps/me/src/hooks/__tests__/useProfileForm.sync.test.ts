import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProfileForm } from "../useProfileForm";
import type { UserProfile } from "@/lib/types";

const register = vi.fn();
const unregister = vi.fn();

vi.mock("@/lib/save-context", () => ({
  useSaveRegister: () => ({ register, unregister }),
}));

vi.mock("@acme/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 1,
    f3Name: "Dredd",
    firstName: "A",
    lastName: "B",
    email: "a@b.test",
    emailVerified: null,
    phone: null,
    homeRegionId: null,
    avatarUrl: null,
    meta: null,
    emergencyContact: null,
    emergencyPhone: null,
    emergencyNotes: null,
    status: "active",
    roles: [],
    positions: [],
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  register.mockClear();
  unregister.mockClear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("useProfileForm user sync", () => {
  it("resets the form when user.id changes but not for other field changes", () => {
    const { result, rerender } = renderHook(
      (props: { user: UserProfile }) => useProfileForm(props),
      { initialProps: { user: makeUser() } },
    );
    act(() => result.current.updateField("f3Name", "Edited"));
    expect(result.current.isDirty).toBe(true);

    rerender({ user: makeUser({ f3Name: "Server renamed" }) });
    expect(result.current.form.f3Name).toBe("Edited");

    rerender({ user: makeUser({ id: 2, f3Name: "Other" }) });
    expect(result.current.form.f3Name).toBe("Other");
    expect(result.current.isDirty).toBe(false);
  });
});

describe("useProfileForm save registration", () => {
  it("registers an onSave that always uses the latest form", async () => {
    const { result } = renderHook(() => useProfileForm({ user: makeUser() }));
    act(() => result.current.updateField("f3Name", "Edited"));

    const last = register.mock.calls.at(-1)?.[0] as {
      isDirty: boolean;
      onSave: () => void;
    };
    expect(last.isDirty).toBe(true);

    await act(async () => {
      last.onSave();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body).toEqual({ f3Name: "Edited" });
  });
});
