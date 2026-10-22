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
vi.mock("@/lib/logging", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

function expectOutageScreen(page: Awaited<ReturnType<typeof renderPage>>) {
  render(page);
  expect(
    screen.getByRole("heading", { name: /temporarily unavailable/i }),
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
    getMyProfile.mockRejectedValue(new TypeError("fetch failed"));

    expectOutageScreen(await renderPage());
  });

  it("shows the outage screen when the regions lookup cannot reach the API", async () => {
    getRegions.mockRejectedValue(
      new ORPCError("SERVICE_UNAVAILABLE", { status: 503 }),
    );

    expectOutageScreen(await renderPage());
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
