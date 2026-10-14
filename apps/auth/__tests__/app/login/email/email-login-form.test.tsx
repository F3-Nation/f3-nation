// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EmailLoginForm from "~/app/login/email/email-login-form";

const { router, searchParams, sendVerificationOtp } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  searchParams: new URLSearchParams(),
  sendVerificationOtp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("~/lib/better-auth-client", () => ({
  authClient: { emailOtp: { sendVerificationOtp } },
}));

const fetchMock = vi.fn<typeof fetch>();
const email = "test+pax@f3nation.test";
const callback = "/api/oauth/authorize?state=a%2Bb&client_id=test-client";

function enterEmail(value = email) {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.delete("callbackUrl");
  fetchMock.mockReset().mockImplementation(async () => Response.json({}));
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("email sign-in", () => {
  it.each(["", "not-an-email", "test user@f3nation.test"])(
    "rejects an invalid email before requesting a code: %j",
    (value) => {
      render(<EmailLoginForm useBetterAuth={false} />);
      enterEmail(value);
      fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

      expect(
        screen.getByText("Please enter a valid email address."),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Send Code" })).toHaveProperty(
        "disabled",
        false,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendVerificationOtp).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  describe.each([false, true])("useBetterAuth=%s", (useBetterAuth) => {
    it("sends a code and preserves the callback in the verification URL", async () => {
      searchParams.set("callbackUrl", callback);
      render(<EmailLoginForm useBetterAuth={useBetterAuth} />);
      enterEmail();
      fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledExactlyOnceWith(
          `/login/email/verify?${new URLSearchParams({ email, callbackUrl: callback })}`,
        ),
      );
      if (useBetterAuth) {
        expect(sendVerificationOtp).toHaveBeenCalledExactlyOnceWith({
          email,
          type: "sign-in",
        });
        expect(fetchMock).not.toHaveBeenCalled();
      } else {
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            action: "send",
            callbackUrl: callback,
          }),
        });
        expect(sendVerificationOtp).not.toHaveBeenCalled();
      }
    });

    it.each(["Please wait before requesting another code.", undefined])(
      "shows a send failure and permits retry (%j)",
      async (message) => {
        if (useBetterAuth) {
          sendVerificationOtp.mockResolvedValueOnce({ error: { message } });
        } else {
          fetchMock.mockResolvedValueOnce(
            Response.json({ error: message }, { status: 429 }),
          );
        }
        render(<EmailLoginForm useBetterAuth={useBetterAuth} />);
        enterEmail();
        fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

        const error = message ?? "Failed to send code";
        expect(await screen.findByText(error)).toBeDefined();
        expect(router.push).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Email address")).toHaveProperty(
          "value",
          email,
        );
        expect(
          screen.getByRole("button", { name: "Send Code" }),
        ).toHaveProperty("disabled", false);

        fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
        await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
        expect(screen.queryByText(error)).toBeNull();
      },
    );
  });

  it("defaults a missing callback to the home page", async () => {
    render(<EmailLoginForm useBetterAuth={false} />);
    enterEmail();
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(
        `/login/email/verify?${new URLSearchParams({ email, callbackUrl: "/" })}`,
      ),
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, action: "send", callbackUrl: "/" }),
    });
    expect(sendVerificationOtp).not.toHaveBeenCalled();
  });

  it("recovers from a network failure without navigating", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<EmailLoginForm useBetterAuth={false} />);
    enterEmail();
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Send Code" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("disables duplicate submissions while the code request is pending", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
    );
    render(<EmailLoginForm useBetterAuth={false} />);
    enterEmail();
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));

    const sending = screen.getByRole("button", { name: "Sending..." });
    expect(sending).toHaveProperty("disabled", true);
    fireEvent.click(sending);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();

    finishRequest?.(Response.json({}));
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
  });
});
