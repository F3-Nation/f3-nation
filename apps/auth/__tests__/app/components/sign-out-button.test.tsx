// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignOutButton from "~/app/components/SignOutButton";

const { nextAuthSignOut, betterAuthSignOut, router } = vi.hoisted(() => ({
  nextAuthSignOut: vi.fn(),
  betterAuthSignOut: vi.fn(),
  router: { push: vi.fn() },
}));

vi.mock("next-auth/react", () => ({ signOut: nextAuthSignOut }));
vi.mock("~/lib/better-auth-client", () => ({
  authClient: { signOut: betterAuthSignOut },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchMock = vi.fn<typeof fetch>();
const errorMessage = "Failed to log out. Please try again.";

function confirmLogout(useBetterAuth: boolean) {
  render(<SignOutButton useBetterAuth={useBetterAuth} />);
  fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
  fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  nextAuthSignOut.mockResolvedValue(undefined);
  betterAuthSignOut.mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sign out", () => {
  it("lets the user cancel without revoking tokens or clearing the session", () => {
    render(<SignOutButton useBetterAuth />);
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    expect(
      screen.getByText("You will be logged out of all apps that use F3 Auth."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nextAuthSignOut).not.toHaveBeenCalled();
    expect(betterAuthSignOut).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    [false, 200],
    [true, 200],
    [true, 401],
  ])(
    "clears the active session after revocation (Better Auth: %s, status: %s)",
    async (useBetterAuth, status) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      confirmLogout(useBetterAuth);

      if (useBetterAuth) {
        await waitFor(() =>
          expect(router.push).toHaveBeenCalledExactlyOnceWith("/login"),
        );
        expect(betterAuthSignOut).toHaveBeenCalledExactlyOnceWith();
        expect(nextAuthSignOut).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(nextAuthSignOut).toHaveBeenCalledExactlyOnceWith({
            callbackUrl: "/login",
          }),
        );
        expect(betterAuthSignOut).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
      }
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/logout", {
        method: "POST",
      });
      expect(screen.queryByText(errorMessage)).toBeNull();
    },
  );

  it.each(["server error", "network failure"])(
    "keeps the session until revocation can be retried after a %s",
    async (failure) => {
      if (failure === "server error") {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      } else {
        fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      }
      confirmLogout(true);

      expect(await screen.findByText(errorMessage)).toBeDefined();
      expect(nextAuthSignOut).not.toHaveBeenCalled();
      expect(betterAuthSignOut).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledExactlyOnceWith("/login"),
      );
      expect(screen.queryByText(errorMessage)).toBeNull();
    },
  );

  it.each(["NextAuth rejection", "Better Auth error", "Better Auth rejection"])(
    "shows a recoverable error after a %s",
    async (failure) => {
      const useBetterAuth = failure !== "NextAuth rejection";
      if (!useBetterAuth) {
        nextAuthSignOut.mockRejectedValueOnce(new Error("Sign-out failed"));
      } else if (failure === "Better Auth error") {
        betterAuthSignOut.mockResolvedValueOnce({
          error: { message: "Sign-out failed" },
        });
      } else {
        betterAuthSignOut.mockRejectedValueOnce(new Error("Sign-out failed"));
      }
      confirmLogout(useBetterAuth);

      expect(await screen.findByText(errorMessage)).toBeDefined();
      expect(router.push).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Log Out" }));

      await waitFor(() => {
        if (useBetterAuth)
          expect(router.push).toHaveBeenCalledExactlyOnceWith("/login");
        else expect(nextAuthSignOut).toHaveBeenCalledTimes(2);
      });
      expect(screen.queryByText(errorMessage)).toBeNull();
    },
  );
});
