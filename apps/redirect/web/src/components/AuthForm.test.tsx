// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the boundaries (auth-client + router); assert OUR component behavior.
const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signInPasskey: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));
vi.mock("@/lib/auth-client", () => ({
  signIn: { email: h.signInEmail, passkey: h.signInPasskey },
  signUp: { email: h.signUpEmail },
}));

import { AuthForm } from "./AuthForm";

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe("AuthForm", () => {
  it("signs in with email+password and routes to the dashboard", async () => {
    h.signInEmail.mockResolvedValue({});
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw123456");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(h.signInEmail).toHaveBeenCalledWith({
        email: "a@b.com",
        password: "pw123456",
      });
      expect(h.push).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("surfaces the server error and does NOT navigate on failure", async () => {
    h.signInEmail.mockResolvedValue({
      error: { message: "invalid credentials" },
    });
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("invalid credentials")).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("creates an account in signup mode", async () => {
    h.signUpEmail.mockResolvedValue({});
    render(<AuthForm />);
    await userEvent.click(screen.getByText("new here? create an account"));
    await userEvent.type(screen.getByLabelText("Email"), "new@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw123456");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" }),
    );

    expect(h.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@b.com", password: "pw123456" }),
    );
    expect(h.signInEmail).not.toHaveBeenCalled();
  });

  it("signs in with a passkey", async () => {
    h.signInPasskey.mockResolvedValue({});
    render(<AuthForm />);
    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with a passkey" }),
    );

    await waitFor(() => {
      expect(h.signInPasskey).toHaveBeenCalled();
      expect(h.push).toHaveBeenCalledWith("/dashboard");
    });
  });
});
