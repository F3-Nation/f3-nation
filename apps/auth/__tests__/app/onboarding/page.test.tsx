// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingPage from "~/app/onboarding/page";

const { envMock, router, searchParams } = vi.hoisted(() => ({
  envMock: { NEXT_PUBLIC_AUTH_URL: undefined as string | undefined },
  router: { push: vi.fn() },
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("~/env", () => ({ env: envMock }));

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
const profile = { f3Name: "Test PAX", firstName: "Test", lastName: "User" };
const authOrigin = "https://auth.f3nation.test";
const browserOrigin = "https://proxy.f3nation.test";
const callback =
  "/api/oauth/authorize?client_id=test-client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=state%2Bwith%26encoding%3Dvalue";

async function fillForm() {
  render(<OnboardingPage />);
  fireEvent.change(await screen.findByLabelText("F3 Name"), {
    target: { value: profile.f3Name },
  });
  fireEvent.change(screen.getByLabelText("First Name"), {
    target: { value: profile.firstName },
  });
  fireEvent.change(screen.getByLabelText("Last Name"), {
    target: { value: profile.lastName },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.delete("callbackUrl");
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json({ isExistingUser: false }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: browserOrigin });
  envMock.NEXT_PUBLIC_AUTH_URL = authOrigin;
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", browserOrigin);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("onboarding continuation", () => {
  it.each([
    ["relative callback", callback, callback],
    [
      "absolute callback",
      `${authOrigin}${callback}`,
      `${authOrigin}${callback}`,
    ],
    ["missing callback", null, "/"],
    ["javascript callback", "javascript:void(0)", "/"],
    ["proxy-origin callback", `${browserOrigin}${callback}`, "/"],
  ])(
    "uses full-page navigation after saving with a %s",
    async (_name, input, destination) => {
      if (input !== null) searchParams.set("callbackUrl", input);
      fetchMock.mockResolvedValueOnce(Response.json({ success: true }));

      await fillForm();
      expect(assign).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() =>
        expect(assign).toHaveBeenCalledExactlyOnceWith(destination),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("uses the browser origin when no canonical Auth URL is configured", async () => {
    envMock.NEXT_PUBLIC_AUTH_URL = undefined;
    searchParams.set("callbackUrl", `${browserOrigin}${callback}`);
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));

    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith(
        `${browserOrigin}${callback}`,
      ),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected POST", "Please try again later"],
    ["network failure", "Something went wrong. Please try again."],
  ])(
    "keeps the form available for retry after a %s",
    async (failure, error) => {
      searchParams.set("callbackUrl", callback);
      if (failure === "rejected POST") {
        fetchMock.mockResolvedValueOnce(
          Response.json({ error }, { status: 500 }),
        );
      } else {
        fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      }

      await fillForm();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByText(error)).toBeDefined();
      expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
        "disabled",
        false,
      );
      expect(screen.getByLabelText("F3 Name")).toHaveProperty(
        "value",
        profile.f3Name,
      );
      expect(screen.getByLabelText("First Name")).toHaveProperty(
        "value",
        profile.firstName,
      );
      expect(screen.getByLabelText("Last Name")).toHaveProperty(
        "value",
        profile.lastName,
      );
      expect(assign).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(Response.json({ success: true }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() =>
        expect(assign).toHaveBeenCalledExactlyOnceWith(callback),
      );
      expect(screen.queryByText(error)).toBeNull();
      expect(router.push).not.toHaveBeenCalled();
    },
  );
});
