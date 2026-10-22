import { isValidElement } from "react";
import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiUnavailable } from "@/components/api-unavailable";
import { ProfileForm } from "@/components/profile-form";

const { requireAuthMock, getMyProfileMock, getRegionsMock, redirectMock } =
  vi.hoisted(() => ({
    requireAuthMock: vi.fn(),
    getMyProfileMock: vi.fn(),
    getRegionsMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
  }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/server", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/api/client", () => ({
  getMyProfile: getMyProfileMock,
  getRegions: getRegionsMock,
  isNotFoundApiError: (err: unknown) =>
    err instanceof ORPCError && err.status === 404,
}));
vi.mock("@/lib/logging", () => ({ logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("@/components/profile-form", () => ({ ProfileForm: () => null }));
vi.mock("@/components/api-unavailable", () => ({ ApiUnavailable: () => null }));

async function renderPage() {
  const { default: ProfilePage } = await import("@/app/profile/page");
  return ProfilePage();
}

function typeOf(node: unknown): unknown {
  return isValidElement(node) ? node.type : undefined;
}

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: 42 });
    getMyProfileMock.mockResolvedValue({ id: 42 });
    getRegionsMock.mockResolvedValue([]);
  });

  it("renders the profile form when the API is up", async () => {
    expect(typeOf(await renderPage())).toBe(ProfileForm);
  });

  it.each([
    ["is unreachable", new TypeError("fetch failed")],
    ["times out", new DOMException("aborted", "AbortError")],
    ["returns a 5xx", new ORPCError("SERVICE_UNAVAILABLE", { status: 503 })],
  ])("shows the outage screen when the profile request %s", async (_l, err) => {
    getMyProfileMock.mockRejectedValue(err);

    expect(typeOf(await renderPage())).toBe(ApiUnavailable);
  });

  it("shows the outage screen when only the regions request fails", async () => {
    getRegionsMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(typeOf(await renderPage())).toBe(ApiUnavailable);
  });

  it("still redirects when the user is not found", async () => {
    getMyProfileMock.mockRejectedValue(
      new ORPCError("NOT_FOUND", { status: 404 }),
    );

    await expect(renderPage()).rejects.toThrow(
      "NEXT_REDIRECT:/?error=user_not_found",
    );
  });

  it("still throws errors that are not an outage", async () => {
    getMyProfileMock.mockRejectedValue(
      new ORPCError("FORBIDDEN", { status: 403 }),
    );

    await expect(renderPage()).rejects.toThrow();
  });
});
