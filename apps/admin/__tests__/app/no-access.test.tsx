import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NoAccess from "~/app/no-access/content";

const {
  navigateToSsoLogin,
  navigateToSsoLogout,
  push,
  searchParams,
  useAdminSession,
} = vi.hoisted(() => ({
  navigateToSsoLogin: vi.fn(),
  navigateToSsoLogout: vi.fn(),
  push: vi.fn(),
  searchParams: { value: new URLSearchParams() },
  useAdminSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams.value,
}));
vi.mock("~/lib/auth/client", () => ({
  navigateToSsoLogin,
  navigateToSsoLogout,
  useAdminSession,
}));

function renderWith(
  reason: string | null,
  session: {
    email: string;
    roles: { orgId: number; orgName: string; roleName: string }[];
  } | null,
) {
  searchParams.value = new URLSearchParams(reason ? { reason } : {});
  useAdminSession.mockReturnValue({ data: session });
  render(<NoAccess />);
}

const session = (
  roles: { orgId: number; orgName: string; roleName: string }[] = [],
) => ({
  email: "pax@example.com",
  roles,
});

afterEach(cleanup);

describe("NoAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers sign-in when no one is logged in", () => {
    renderWith(null, null);

    expect(
      screen.getByRole("heading", { name: "Access Denied" }),
    ).toBeDefined();
    expect(screen.getByText("You are not logged in.")).toBeDefined();
    expect(screen.queryByText("Think you should have access?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(navigateToSsoLogin).toHaveBeenCalledWith("/");
  });

  it("explains a missing account", () => {
    renderWith("account-does-not-exist", null);

    expect(screen.getByText(/This account does not exist/)).toBeDefined();
  });

  it.each(["not-admin", "not-editor", "no-admin-access"])(
    "asks for a role when the reason is %s",
    (reason) => {
      renderWith(reason, session());

      expect(
        screen.getByRole("heading", { name: "Permission Required" }),
      ).toBeDefined();
      expect(screen.getByText("pax@example.com")).toBeDefined();
      expect(screen.getByText("Think you should have access?")).toBeDefined();
    },
  );

  it("lists a signed-in user's roles when access is denied for another reason", () => {
    renderWith(
      null,
      session([
        { orgId: 1, orgName: "Boone", roleName: "editor" },
        { orgId: 2, orgName: "Watauga", roleName: "admin" },
      ]),
    );

    expect(
      screen.getByRole("heading", { name: "Access Denied" }),
    ).toBeDefined();
    expect(screen.getByText(/Your roles:/).textContent).toBe(
      "Your roles: Boone - editor, Watauga - admin",
    );
  });

  it("leaves out the role list when the user has no roles", () => {
    renderWith(null, session());

    expect(
      screen.getByText("You don't have access to the requested resource."),
    ).toBeDefined();
    expect(screen.queryByText(/Your roles:/)).toBeNull();
  });

  it("lets a signed-in user sign out or go home", () => {
    renderWith("not-admin", session());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign out and try a different account",
      }),
    );
    expect(navigateToSsoLogout).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go to home page" }));
    expect(push).toHaveBeenCalledWith("/");
  });
});
