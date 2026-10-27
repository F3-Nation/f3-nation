import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, render, screen } from "@testing-library/react";
import type * as ClientModule from "@/lib/api/client";

const { getMyProfile, getRegions, redirect } = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  getRegions: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 42 }),
}));
vi.mock("@/lib/api/client", async () => {
  const { isNotFoundApiError } =
    await vi.importActual<typeof ClientModule>("@/lib/api/client");
  return { getMyProfile, getRegions, isNotFoundApiError };
});
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/profile-form", () => ({ ProfileForm: () => null }));
vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span>{props.alt}</span>,
}));
const { logError, logWarn } = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock("@/lib/logging", () => ({ logError, logWarn }));

function expectOutageScreen(page: Awaited<ReturnType<typeof renderPage>>) {
  render(page);
  expect(
    screen.getByRole("heading", {
      level: 1,
      name: /temporarily unavailable/i,
    }),
  ).toBeDefined();
}

async function renderPage() {
  const { default: ProfilePage } = await import("@/app/profile/page");
  return ProfilePage();
}

afterEach(cleanup);

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyProfile.mockResolvedValue({ id: 42 });
    getRegions.mockResolvedValue([]);
  });

  it("shows the outage screen when the profile lookup cannot reach the API", async () => {
    const err = new TypeError("fetch failed");
    getMyProfile.mockRejectedValue(err);

    expectOutageScreen(await renderPage());
    expect(logWarn).toHaveBeenCalledWith(
      "me.profile.api_unavailable",
      expect.objectContaining({ lookup: "profile", err }),
    );
  });

  it("shows the outage screen when the regions lookup cannot reach the API", async () => {
    const err = new ORPCError("SERVICE_UNAVAILABLE", { status: 503 });
    getRegions.mockRejectedValue(err);

    expectOutageScreen(await renderPage());
    expect(logWarn).toHaveBeenCalledWith(
      "me.profile.api_unavailable",
      expect.objectContaining({ lookup: "regions", err }),
    );
  });

  it("logs a well-formed API 500 at error level, since it may be a bug", async () => {
    const err = new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 });
    getMyProfile.mockRejectedValue(err);

    expectOutageScreen(await renderPage());
    expect(logError).toHaveBeenCalledWith(
      "me.profile.api_unavailable",
      expect.objectContaining({ lookup: "profile" }),
      err,
    );
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("still sends a missing user to the sign-in screen", async () => {
    getMyProfile.mockRejectedValue(new ORPCError("NOT_FOUND", { status: 404 }));

    await expect(renderPage()).rejects.toThrow(
      "NEXT_REDIRECT /?error=user_not_found",
    );
  });

  it("still throws errors that are not outages", async () => {
    getMyProfile.mockRejectedValue(new Error("boom"));

    await expect(renderPage()).rejects.toThrow("boom");
  });
});
