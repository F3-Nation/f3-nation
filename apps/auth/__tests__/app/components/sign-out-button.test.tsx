// @vitest-environment jsdom

import {
  act,
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
  fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
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
      let resolveRevocation!: (response: Response) => void;
      fetchMock.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveRevocation = resolve;
        }),
      );
      let resolveSignOut!: (result: { error: null }) => void;
      betterAuthSignOut.mockReturnValueOnce(
        new Promise<{ error: null }>((resolve) => {
          resolveSignOut = resolve;
        }),
      );
      confirmLogout(useBetterAuth);

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/logout", {
        method: "POST",
      });
      expect(nextAuthSignOut).not.toHaveBeenCalled();
      expect(betterAuthSignOut).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();

      await act(async () => {
        resolveRevocation(new Response(null, { status }));
      });

      if (useBetterAuth) {
        expect(betterAuthSignOut).toHaveBeenCalledExactlyOnceWith();
        expect(nextAuthSignOut).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();

        await act(async () => {
          resolveSignOut({ error: null });
        });
        await waitFor(() =>
          expect(router.push).toHaveBeenCalledExactlyOnceWith("/login"),
        );
      } else {
        await waitFor(() =>
          expect(nextAuthSignOut).toHaveBeenCalledExactlyOnceWith({
            callbackUrl: "/login",
          }),
        );
        expect(betterAuthSignOut).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
      }
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
