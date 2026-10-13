// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VerifyEmailForm from "~/app/login/email/verify/verify-email-form";

const { router, searchParams, signIn, emailOtp } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  searchParams: new URLSearchParams(),
  signIn: vi.fn(),
  emailOtp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
}));
vi.mock("next-auth/react", () => ({ signIn }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("~/lib/better-auth-client", () => ({
  authClient: { signIn: { emailOtp } },
}));

const fetchMock = vi.fn<typeof fetch>();
const email = "test+pax@f3nation.test";
const code = "123456";
const callback = "/api/oauth/authorize?state=a%2Bb&client_id=test-client";

function submitCode() {
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.set("email", email);
  searchParams.set("callbackUrl", callback);
  searchParams.delete("code");
  fetchMock
    .mockReset()
    .mockImplementation(async () => Response.json({ exists: true }));
  signIn.mockReset().mockResolvedValue({ error: null });
  emailOtp.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", "https://auth.f3nation.test");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("email verification", () => {
  describe.each([false, true])("useBetterAuth=%s", (useBetterAuth) => {
    it("signs in an existing user with the selected backend", async () => {
      render(<VerifyEmailForm useBetterAuth={useBetterAuth} />);
      submitCode();

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
      );
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/check-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (useBetterAuth) {
        expect(emailOtp).toHaveBeenCalledExactlyOnceWith({ email, otp: code });
        expect(signIn).not.toHaveBeenCalled();
      } else {
        expect(signIn).toHaveBeenCalledExactlyOnceWith("email-mfa", {
          email,
          code,
          redirect: false,
        });
        expect(emailOtp).not.toHaveBeenCalled();
      }
    });

    it("keeps the form available after a rejected sign-in and permits retry", async () => {
      if (useBetterAuth) {
        emailOtp.mockResolvedValueOnce({ error: { status: 401 } });
      } else {
        signIn.mockResolvedValueOnce({ error: "CredentialsSignin" });
      }
      render(<VerifyEmailForm useBetterAuth={useBetterAuth} />);
      submitCode();

      const error = "Invalid or expired code. Please try again.";
      expect(await screen.findByText(error)).toBeDefined();
      expect(screen.getByRole("button", { name: "Verify" })).toHaveProperty(
        "disabled",
        false,
      );
      expect(router.push).not.toHaveBeenCalled();

      submitCode();
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
      );
      expect(screen.queryByText(error)).toBeNull();
    });
  });

  it("sends a new user to registration without consuming the code", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ exists: false }));
    render(<VerifyEmailForm useBetterAuth={false} />);
    submitCode();

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(
        `/register?${new URLSearchParams({ email, code, callbackUrl: callback })}`,
      ),
    );
    expect(signIn).not.toHaveBeenCalled();
    expect(emailOtp).not.toHaveBeenCalled();
  });

  it("submits a magic-link code automatically", async () => {
    searchParams.set("code", code);
    render(<VerifyEmailForm useBetterAuth={false} />);

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
    expect(screen.getByLabelText("Verification code")).toHaveProperty(
      "value",
      code,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signIn).toHaveBeenCalledExactlyOnceWith("email-mfa", {
      email,
      code,
      redirect: false,
    });
  });

  it("shows a recoverable error when sign-in throws", async () => {
    signIn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<VerifyEmailForm useBetterAuth={false} />);
    submitCode();

    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Verify" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    [429, "Too many attempts. Please wait a minute and try again."],
    [500, "Something went wrong. Please try again."],
  ])(
    "does not consume a code when the user check returns %s",
    async (status, error) => {
      fetchMock.mockResolvedValueOnce(Response.json({}, { status }));
      render(<VerifyEmailForm useBetterAuth={false} />);
      submitCode();

      expect(await screen.findByText(error)).toBeDefined();
      expect(signIn).not.toHaveBeenCalled();
      expect(emailOtp).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Verify" })).toHaveProperty(
        "disabled",
        false,
      );
    },
  );

  it("shows Better Auth's rate-limit error without redirecting", async () => {
    emailOtp.mockResolvedValueOnce({ error: { status: 429 } });
    render(<VerifyEmailForm useBetterAuth />);
    submitCode();

    expect(
      await screen.findByText(
        "Too many attempts. Please wait a moment and try again.",
      ),
    ).toBeDefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    [
      "https://auth.f3nation.test/continue?state=test",
      "https://auth.f3nation.test/continue?state=test",
    ],
    ["https://external.example/continue", "/"],
    [null, "/"],
  ])("chooses a safe destination for callback %j", async (input, expected) => {
    if (input === null) searchParams.delete("callbackUrl");
    else searchParams.set("callbackUrl", input);
    render(<VerifyEmailForm useBetterAuth={false} />);
    submitCode();

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(expected),
    );
  });

  it("uses the browser origin when a canonical Auth URL is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_URL", undefined);
    vi.stubGlobal("location", { origin: "https://proxy.f3nation.test" });
    const destination = "https://proxy.f3nation.test/continue";
    searchParams.set("callbackUrl", destination);
    render(<VerifyEmailForm useBetterAuth={false} />);
    submitCode();

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(destination),
    );
  });

  it("does not auto-submit a magic-link code without an email", () => {
    searchParams.delete("email");
    searchParams.set("code", code);
    render(<VerifyEmailForm useBetterAuth={false} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
    expect(emailOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Verify" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("accepts only digits and enables submission at six digits", () => {
    render(<VerifyEmailForm useBetterAuth={false} />);
    const input = screen.getByLabelText("Verification code");
    const verify = screen.getByRole("button", { name: "Verify" });
    expect(verify).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "12a34" } });
    expect(input).toHaveProperty("value", "1234");
    expect(verify).toHaveProperty("disabled", true);
    fireEvent.change(input, { target: { value: code } });
    expect(verify).toHaveProperty("disabled", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the callback when requesting another code", () => {
    render(<VerifyEmailForm useBetterAuth={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `/login/email?callbackUrl=${encodeURIComponent(callback)}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for the user check and disables duplicate submissions", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
    );
    render(<VerifyEmailForm useBetterAuth={false} />);
    submitCode();

    const verifying = screen.getByRole("button", { name: "Verifying..." });
    expect(verifying).toHaveProperty("disabled", true);
    fireEvent.click(verifying);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    finishRequest?.(Response.json({ exists: true }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
  });
});
