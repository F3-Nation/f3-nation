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

const { router, searchParams } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
}));
vi.mock("next/image", () => ({ default: () => null }));

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
const profile = { f3Name: "Test PAX", firstName: "Test", lastName: "User" };
const regions = [
  { id: 1, name: "Test North" },
  { id: 2, name: "Test South" },
];
// Region ids come from /api/regions, which has its own stub below so the
// numbered fetchMock calls stay the prefill (1) and the save (2).
const saved = { ...profile, homeRegionId: 2 };
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

const regionsFetch = vi.fn<() => Promise<Response>>();

function prefill(data: Record<string, unknown>) {
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json(data));
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.delete("callbackUrl");
  prefill({ isExistingUser: false, homeRegionId: 2 });
  regionsFetch
    .mockReset()
    .mockImplementation(async () => Response.json(regions));
  vi.stubGlobal(
    "fetch",
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      input === "/api/regions" ? regionsFetch() : fetchMock(input, init),
  );
  vi.stubGlobal("location", { assign, origin: browserOrigin });
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", authOrigin);
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
    ["same-origin blob callback", `blob:${authOrigin}/id`, "/"],
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
        body: JSON.stringify(saved),
      });
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("uses the browser origin when no canonical Auth URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_URL", undefined);
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

  it("keeps Continue disabled while full-page navigation is pending", async () => {
    searchParams.set("callbackUrl", callback);
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));

    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith(callback),
    );
    const button = screen.getByRole("button");
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("allows retry if starting full-page navigation throws", async () => {
    searchParams.set("callbackUrl", callback);
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    assign.mockImplementationOnce(() => {
      throw new DOMException("Navigation failed", "SecurityError");
    });

    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeDefined();
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    expect(assign).toHaveBeenLastCalledWith(callback);
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
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

describe("home region", () => {
  async function renderForm() {
    render(<OnboardingPage />);
    await screen.findByLabelText("F3 Name");
  }

  it("shows the saved home region so it can be confirmed", async () => {
    await renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText("Home Region")).toHaveProperty(
        "value",
        "Test South",
      ),
    );
  });

  it("saves the region the user picks instead", async () => {
    prefill({ ...profile, homeRegionId: 2, isExistingUser: true });
    searchParams.set("callbackUrl", callback);
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));
    await renderForm();

    fireEvent.change(screen.getByLabelText("Home Region"), {
      target: { value: "north" },
    });
    const north = screen.getByRole("button", { name: "Test North" });
    fireEvent.mouseDown(north);
    fireEvent.click(north);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...profile, homeRegionId: 1 }),
    });
  });

  it("does not save until a region is chosen", async () => {
    prefill({ ...profile, homeRegionId: null, isExistingUser: true });
    await renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
  });

  it("asks again when the saved region is no longer on the list", async () => {
    prefill({ ...profile, homeRegionId: 99, isExistingUser: true });
    await renderForm();

    expect(screen.getByLabelText("Home Region")).toHaveProperty("value", "");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
  });

  it("still saves the profile when the region list can't load", async () => {
    prefill({ ...profile, homeRegionId: null, isExistingUser: true });
    regionsFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    searchParams.set("callbackUrl", callback);
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));
    await renderForm();

    expect(screen.queryByLabelText("Home Region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
  });
});
