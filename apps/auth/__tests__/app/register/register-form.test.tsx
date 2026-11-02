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
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import RegisterForm from "~/app/register/register-form";

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
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next-auth/react", () => ({ signIn }));
vi.mock("~/lib/better-auth-client", () => ({
  authClient: { signIn: { emailOtp } },
}));

const fetchMock = vi.fn<typeof fetch>();
const email = "new-pax@example.test";
const code = "123456";
const callback =
  "/api/oauth/authorize?client_id=test-client&state=state%2Bvalue";
const regions = [
  { id: 1, name: "Test North" },
  { id: 2, name: "Test South" },
];

function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function fillForm(useBetterAuth = false) {
  await act(async () => {
    render(<RegisterForm useBetterAuth={useBetterAuth} />);
  });
  change(/First Name/, "Test");
  change(/Last Name/, "PAX");
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
}

function registrationForm() {
  const form = screen.getByLabelText<HTMLInputElement>(/First Name/).form;
  if (!form) throw new Error("Registration form not found");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  router.push.mockReset();
  sessionStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  searchParams.set("email", email);
  searchParams.set("code", code);
  searchParams.set("callbackUrl", callback);
  fetchMock
    .mockReset()
    .mockImplementation(async () => Response.json({ success: true }));
  fetchMock.mockResolvedValueOnce(Response.json(regions));
  signIn.mockReset().mockResolvedValue({ error: null });
  emailOtp.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Each test renders the full form; on a loaded CI runner the slowest ones
// exceed the 5s default.
describe("registration", { timeout: 20_000 }, () => {
  it.each([
    {
      useBetterAuth: false,
      field: "email",
      nextEmail: "second-pax@example.test",
      nextCode: code,
    },
    {
      useBetterAuth: true,
      field: "email",
      nextEmail: "second-pax@example.test",
      nextCode: code,
    },
    {
      useBetterAuth: false,
      field: "code",
      nextEmail: email,
      nextCode: "654321",
    },
    {
      useBetterAuth: true,
      field: "code",
      nextEmail: email,
      nextCode: "654321",
    },
  ])(
    "allows a changed $field after a completed registration (Better Auth: $useBetterAuth)",
    async ({ useBetterAuth, nextEmail, nextCode }) => {
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = render(<RegisterForm useBetterAuth={useBetterAuth} />);
      });
      change(/First Name/, "First");
      change(/Last Name/, "PAX");
      await act(async () => submit());
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback);
      searchParams.set("callbackUrl", "/account");
      await act(async () =>
        view.rerender(<RegisterForm useBetterAuth={useBetterAuth} />),
      );
      expect(screen.getByLabelText(/First Name/)).toHaveProperty(
        "value",
        "First",
      );
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", true);
      await act(async () => registrationForm().requestSubmit());
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/register"),
      ).toHaveLength(1);

      searchParams.set("email", nextEmail);
      searchParams.set("code", nextCode);
      fetchMock.mockResolvedValueOnce(Response.json(regions));
      await act(async () =>
        view.rerender(<RegisterForm useBetterAuth={useBetterAuth} />),
      );
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", false);
      expect(screen.getByLabelText(/First Name/)).toHaveProperty("value", "");
      change(/First Name/, "Second");
      change(/Last Name/, "PAX");
      await act(async () => registrationForm().requestSubmit());
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/register"),
      ).toHaveLength(2);
      expect(fetchMock).toHaveBeenLastCalledWith("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: nextEmail,
          code: nextCode,
          firstName: "Second",
          lastName: "PAX",
        }),
      });
      expect(useBetterAuth ? emailOtp : signIn).toHaveBeenCalledTimes(2);
      expect(router.push).toHaveBeenLastCalledWith("/account");
    },
  );

  it("restores only the matching draft and resets phone defaults for a new email", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    const nextEmail = "returning-pax@example.test";
    sessionStorage.setItem(
      "f3-register-draft",
      JSON.stringify({
        email: nextEmail,
        f3Name: "Returning Runner",
        firstName: "Returning",
        lastName: "PAX",
        homeRegionId: 2,
        regionSearch: "Test South",
      }),
    );
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<RegisterForm useBetterAuth={false} />);
    });
    expect(screen.getByLabelText(/First Name/)).toHaveProperty("value", "");
    const country = view.container.querySelector("#phoneCountry")!;
    fireEvent.change(country, { target: { value: "CA" } });
    searchParams.set("email", nextEmail);
    fetchMock.mockResolvedValueOnce(Response.json(regions));
    await act(async () =>
      view.rerender(<RegisterForm useBetterAuth={false} />),
    );
    expect(screen.getByLabelText(/First Name/)).toHaveProperty(
      "value",
      "Returning",
    );
    expect(screen.getByLabelText("F3 Name")).toHaveProperty(
      "value",
      "Returning Runner",
    );
    expect(screen.getByLabelText("Home Region")).toHaveProperty(
      "value",
      "Test South",
    );
    expect(view.container.querySelector("#phoneCountry")).toHaveProperty(
      "value",
      "GB",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Emergency Contact Info/ }),
    );
    expect(
      view.container.querySelector("#emergencyPhoneCountry"),
    ).toHaveProperty("value", "GB");
  });

  it("hydrates browser defaults without replacing edits on rerender", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    sessionStorage.setItem(
      "f3-register-draft",
      JSON.stringify({
        email,
        f3Name: "Saved Runner",
        firstName: "Saved",
        lastName: "PAX",
        homeRegionId: 2,
        regionSearch: "Test South",
      }),
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <RegisterForm useBetterAuth={false} />,
    );
    expect(container.querySelector<HTMLInputElement>("#firstName")?.value).toBe(
      "",
    );
    expect(
      container.querySelector<HTMLSelectElement>("#phoneCountry")?.value,
    ).toBe("US");
    document.body.append(container);
    const recoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <RegisterForm useBetterAuth={false} />, {
          onRecoverableError: recoverableError,
        });
      });
      expect(screen.getByLabelText(/First Name/)).toHaveProperty(
        "value",
        "Saved",
      );
      expect(screen.getByLabelText("Home Region")).toHaveProperty(
        "value",
        "Test South",
      );
      expect(container.querySelector("#phoneCountry")).toHaveProperty(
        "value",
        "GB",
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Emergency Contact Info/ }),
      );
      expect(container.querySelector("#emergencyPhoneCountry")).toHaveProperty(
        "value",
        "GB",
      );
      change(/First Name/, "Edited");
      fireEvent.change(container.querySelector("#phoneCountry")!, {
        target: { value: "CA" },
      });
      await act(async () =>
        root?.render(<RegisterForm useBetterAuth={false} />),
      );
      expect(screen.getByLabelText(/First Name/)).toHaveProperty(
        "value",
        "Edited",
      );
      expect(container.querySelector("#phoneCountry")).toHaveProperty(
        "value",
        "CA",
      );
      expect(recoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it.each([false, true])(
    "creates the account before signing in (Better Auth: %s)",
    async (useBetterAuth) => {
      let resolveRegistration!: (response: Response) => void;
      const registration = new Promise<Response>((resolve) => {
        resolveRegistration = resolve;
      });
      fetchMock.mockImplementationOnce(() => registration);
      await fillForm(useBetterAuth);
      submit();

      expect(
        screen.getByRole("button", { name: "Creating Account..." }),
      ).toHaveProperty("disabled", true);
      expect(signIn).not.toHaveBeenCalled();
      expect(emailOtp).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code,
          firstName: "Test",
          lastName: "PAX",
        }),
      });

      resolveRegistration(Response.json({ success: true }));
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
      );
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
    },
  );

  it.each([false, true])(
    "ignores repeated form submissions while registration or sign-in is pending (Better Auth: %s)",
    async (useBetterAuth) => {
      let resolveRegistration!: (response: Response) => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRegistration = resolve;
          }),
      );
      let resolveSignIn!: (result: { error: null }) => void;
      const pendingSignIn = new Promise<{ error: null }>((resolve) => {
        resolveSignIn = resolve;
      });
      const signInMock = useBetterAuth ? emailOtp : signIn;
      signInMock.mockReturnValueOnce(pendingSignIn);
      await fillForm(useBetterAuth);

      act(() => {
        registrationForm().requestSubmit();
        registrationForm().requestSubmit();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(signInMock).not.toHaveBeenCalled();

      await act(async () => {
        resolveRegistration(Response.json({ created: true }));
      });
      expect(signInMock).toHaveBeenCalledTimes(1);
      act(() => registrationForm().requestSubmit());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(router.push).not.toHaveBeenCalled();

      await act(async () => {
        resolveSignIn({ error: null });
      });
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback);
    },
  );

  describe.each([false, true])(
    "successful navigation (Better Auth: %s)",
    (useBetterAuth) => {
      it.each(["click", "requestSubmit"])(
        "ignores another %s while the completed form remains mounted",
        async (method) => {
          await fillForm(useBetterAuth);
          const button = screen.getByRole("button", { name: "Create Account" });
          await act(async () => submit());

          expect(router.push).toHaveBeenCalledExactlyOnceWith(callback);
          await act(async () => {
            if (method === "click") fireEvent.click(button);
            else registrationForm().requestSubmit();
          });

          expect(
            fetchMock.mock.calls.filter(([url]) => url === "/api/register"),
          ).toHaveLength(1);
          expect(useBetterAuth ? emailOtp : signIn).toHaveBeenCalledTimes(1);
          expect(router.push).toHaveBeenCalledExactlyOnceWith(callback);
          expect(button).toHaveProperty("disabled", true);
        },
      );
    },
  );

  it.each([false, true])(
    "offers sign-in recovery if navigation throws after account creation (Better Auth: %s)",
    async (useBetterAuth) => {
      await fillForm(useBetterAuth);
      router.push.mockImplementationOnce(() => {
        throw new Error("Navigation failed");
      });
      await act(async () => submit());

      expect(screen.getByText(/Your account was created/)).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", true);
      expect(
        screen.queryByRole("button", { name: "Creating Account..." }),
      ).toBeNull();
      await act(async () => registrationForm().requestSubmit());
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/register"),
      ).toHaveLength(1);
      expect(useBetterAuth ? emailOtp : signIn).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
      expect(router.push).toHaveBeenLastCalledWith(
        `/login/email?callbackUrl=${encodeURIComponent(callback)}`,
      );
    },
  );

  it.each([
    ["missing callback", null, "/"],
    ["external callback", "https://outside.example/callback", "/"],
    [
      "same-origin callback",
      "https://auth.example.test/account",
      "https://auth.example.test/account",
    ],
  ])("uses a safe destination for a %s", async (_name, input, destination) => {
    if (input === null) searchParams.delete("callbackUrl");
    else searchParams.set("callbackUrl", input);
    vi.stubGlobal("location", { origin: "https://auth.example.test" });
    await fillForm();
    submit();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(destination),
    );
  });

  it.each(["email", "code"])(
    "returns to login when the %s is missing",
    async (parameter) => {
      searchParams.delete(parameter);
      await fillForm();
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/login");
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/regions");
      expect(signIn).not.toHaveBeenCalled();
    },
  );

  it("submits optional details, selected region and international phone numbers", async () => {
    await fillForm();
    change("F3 Name", "Test Runner");
    change("Home Region", "sOuTh");
    expect(screen.queryByRole("option", { name: "Test North" })).toBeNull();
    const region = screen.getByRole("option", { name: "Test South" });
    fireEvent.mouseDown(region);
    fireEvent.click(region);
    change("Phone Number", "2025550123");
    fireEvent.change(document.querySelector("#phoneCountry")!, {
      target: { value: "GB" },
    });
    expect(screen.getByLabelText("Phone Number")).toHaveProperty("value", "");
    change("Phone Number", "02079460018");
    fireEvent.click(
      screen.getByRole("button", { name: /Emergency Contact Info/ }),
    );
    change("Emergency Contact Name", "Test Contact");
    change("Emergency Phone", "2025550124");
    change("Notes", "Call the emergency contact first.");
    fireEvent.click(
      screen.getByRole("button", { name: /Emergency Contact Info/ }),
    );
    expect(screen.queryByLabelText("Emergency Contact Name")).toBeNull();
    submit();

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        code,
        f3Name: "Test Runner",
        firstName: "Test",
        lastName: "PAX",
        homeRegionId: 2,
        phone: "+442079460018",
        emergencyContact: "Test Contact",
        emergencyPhone: "+12025550124",
        emergencyNotes: "Call the emergency contact first.",
      }),
    });
  });

  it("keeps selected regions on blur and discards unmatched search text", async () => {
    await fillForm();
    vi.useFakeTimers();
    const input = screen.getByLabelText("Home Region");
    fireEvent.focus(input);
    const region = screen.getByRole("option", { name: "Test South" });
    fireEvent.mouseDown(region);
    fireEvent.blur(input);
    fireEvent.click(region);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(input).toHaveProperty("value", "Test South");
    fireEvent.focus(input);
    fireEvent.blur(input);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(input).toHaveProperty("value", "Test South");

    change("Home Region", "Unknown region");
    expect(screen.getByText("No regions found")).toBeDefined();
    fireEvent.blur(input);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(input).toHaveProperty("value", "");
    fireEvent.focus(input);
    expect(screen.getByRole("option", { name: "Test North" })).toBeDefined();
    fireEvent.mouseDown(
      screen.getByRole("heading", { name: "Create Your Account" }),
    );
    expect(screen.queryByRole("option", { name: "Test North" })).toBeNull();
    vi.useRealTimers();
    submit();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/register",
      expect.objectContaining({
        body: JSON.stringify({
          email,
          code,
          firstName: "Test",
          lastName: "PAX",
        }),
      }),
    );
  });

  it("allows registration when optional region discovery fails", async () => {
    fetchMock
      .mockReset()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ success: true }));
    await fillForm();
    submit();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
  });

  it.each([
    [/First Name/, " ", "First name and last name are required."],
    [/Last Name/, " ", "First name and last name are required."],
    ["Phone Number", "123", "Please enter a valid phone number."],
    ["Emergency Phone", "123", "Please enter a valid emergency phone number."],
  ])("validates %s before creating an account", async (label, value, error) => {
    await fillForm();
    fireEvent.click(
      screen.getByRole("button", { name: /Emergency Contact Info/ }),
    );
    change(label, value);
    submit();
    expect(await screen.findByText(error)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toHaveProperty("disabled", false);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/regions");
    expect(signIn).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    [
      "API error",
      () =>
        Response.json({ error: "An account already exists." }, { status: 409 }),
      "An account already exists.",
    ],
    [
      "non-JSON error",
      () => new Response("Unavailable", { status: 503 }),
      "Registration failed. Please try again.",
    ],
  ])("preserves the form after an %s", async (_name, response, error) => {
    fetchMock.mockResolvedValueOnce(response());
    await fillForm();
    submit();
    expect(await screen.findByText(error)).toBeDefined();
    expect(screen.getByLabelText(/First Name/)).toHaveProperty("value", "Test");
    expect(screen.getByLabelText(/Last Name/)).toHaveProperty("value", "PAX");
    expect(signIn).not.toHaveBeenCalled();
    expect(emailOtp).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
    submit();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
    expect(screen.queryByText(error)).toBeNull();
  });

  it.each([false, true])(
    "allows retry after a network failure before creation is confirmed (Better Auth: %s)",
    async (useBetterAuth) => {
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await fillForm(useBetterAuth);
      submit();
      expect(
        await screen.findByText("Something went wrong. Please try again."),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", false);
      expect(signIn).not.toHaveBeenCalled();
      expect(emailOtp).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "Sign in again" }),
      ).toBeNull();

      submit();
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each([false, true])(
    "offers sign-in recovery after sign-in throws without registering again (Better Auth: %s)",
    async (useBetterAuth) => {
      const signInMock = useBetterAuth ? emailOtp : signIn;
      signInMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await fillForm(useBetterAuth);
      submit();

      const error =
        "Your account was created, but we couldn't sign you in. Please sign in again to continue.";
      expect(await screen.findByText(error)).toBeDefined();
      expect(router.push).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", true);

      submit();
      act(() => registrationForm().requestSubmit());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(signInMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(error)).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith(
        `/login/email?callbackUrl=${encodeURIComponent(callback)}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([false, true])(
    "offers a fresh code without resubmitting when registration rejects the code (Better Auth: %s)",
    async (useBetterAuth) => {
      const error =
        "Your verification code is invalid or has expired. Please sign in again.";
      fetchMock.mockResolvedValueOnce(
        Response.json({ error }, { status: 401 }),
      );
      await fillForm(useBetterAuth);
      submit();
      expect(await screen.findByText(error)).toBeDefined();
      expect(signIn).not.toHaveBeenCalled();
      expect(emailOtp).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", true);
      act(() => registrationForm().requestSubmit());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith(
        `/login/email?callbackUrl=${encodeURIComponent(callback)}`,
      );
    },
  );

  it("keeps the answers for a fresh code after the code is rejected", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "expired" }, { status: 401 }),
    );
    await fillForm();
    change("F3 Name", "Test Runner");
    change("Home Region", "South");
    const region = screen.getByRole("option", { name: "Test South" });
    fireEvent.mouseDown(region);
    fireEvent.click(region);
    change("Phone Number", "2025550123");
    fireEvent.click(
      screen.getByRole("button", { name: /Emergency Contact Info/ }),
    );
    change("Emergency Contact Name", "Test Contact");
    submit();
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in again" }),
    );
    // Phone numbers and the emergency contact are never written to storage.
    const stored = sessionStorage.getItem("f3-register-draft") ?? "";
    expect(stored).toContain("Test Runner");
    expect(stored).not.toContain("5550123");
    expect(stored).not.toContain("Test Contact");
    cleanup();

    // Back from the new code: same email, form comes back filled in.
    const freshCode = "654321";
    searchParams.set("code", freshCode);
    fetchMock.mockResolvedValueOnce(Response.json(regions));
    await act(async () => {
      render(<RegisterForm useBetterAuth={false} />);
    });
    expect(screen.getByLabelText(/First Name/)).toHaveProperty("value", "Test");
    expect(screen.getByLabelText("F3 Name")).toHaveProperty(
      "value",
      "Test Runner",
    );
    expect(screen.getByLabelText("Phone Number")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Home Region")).toHaveProperty(
      "value",
      "Test South",
    );

    // A different email gets a blank form.
    cleanup();
    searchParams.set("email", "someone-else@example.test");
    fetchMock.mockResolvedValueOnce(Response.json(regions));
    await act(async () => {
      render(<RegisterForm useBetterAuth={false} />);
    });
    expect(screen.getByLabelText(/First Name/)).toHaveProperty("value", "");

    // Returning to the original email preserves its selected region and uses the fresh code.
    cleanup();
    searchParams.set("email", email);
    fetchMock.mockResolvedValueOnce(Response.json(regions));
    await act(async () => {
      render(<RegisterForm useBetterAuth={false} />);
    });
    submit();
    await waitFor(() => expect(router.push).toHaveBeenLastCalledWith(callback));
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/register"),
    ).toHaveLength(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        code: freshCode,
        f3Name: "Test Runner",
        firstName: "Test",
        lastName: "PAX",
        homeRegionId: 2,
      }),
    });
  });

  it("clears a saved draft once registration succeeds", async () => {
    sessionStorage.setItem(
      "f3-register-draft",
      JSON.stringify({
        email,
        f3Name: "",
        firstName: "Saved",
        lastName: "PAX",
        homeRegionId: "",
        regionSearch: "",
      }),
    );
    await fillForm();
    expect(screen.getByLabelText(/First Name/)).toHaveProperty("value", "Test");
    submit();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledExactlyOnceWith(callback),
    );
    expect(sessionStorage.getItem("f3-register-draft")).toBeNull();
  });

  it.each([
    [
      "NextAuth expired code",
      false,
      401,
      "Your account was created, but your code has expired. Please sign in again to continue.",
    ],
    [
      "Better Auth expired code",
      true,
      401,
      "Your account was created, but your code has expired. Please sign in again to continue.",
    ],
    [
      "Better Auth rate limit",
      true,
      429,
      "Your account was created, but you've hit the sign-in rate limit. Please wait a moment, then sign in again to continue.",
    ],
  ])(
    "offers sign-in recovery after %s without registering again",
    async (_name, useBetterAuth, status, error) => {
      signIn.mockResolvedValue({ error: "CredentialsSignin" });
      emailOtp.mockResolvedValue({ error: { status } });
      await fillForm(useBetterAuth);
      submit();
      expect(await screen.findByText(error)).toBeDefined();
      expect(router.push).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toHaveProperty("disabled", true);
      submit();
      act(() => registrationForm().requestSubmit());
      expect(screen.getByText(error)).toBeDefined();
      expect(useBetterAuth ? emailOtp : signIn).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith(
        `/login/email?callbackUrl=${encodeURIComponent(callback)}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
