import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiUnavailable } from "~/app/_components/api-unavailable";

const { headersMock, getSessionLookupMock, requireAdminPortalAccessMock } =
  vi.hoisted(() => ({
    headersMock: vi.fn(),
    getSessionLookupMock: vi.fn(),
    requireAdminPortalAccessMock: vi.fn(),
  }));

vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "mono" } }));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "sans" } }));
vi.mock("~/env", () => ({
  env: { F3_GOOGLE_API_KEY: "", F3_CHANNEL: "local" },
}));
vi.mock("~/lib/auth/server", () => ({
  getSessionLookup: getSessionLookupMock,
  requireAdminPortalAccess: requireAdminPortalAccessMock,
}));
// The portal's provider tree is irrelevant here; only which branch renders is.
vi.mock("~/app/_components/modal/modal-switcher", () => ({
  ModalSwitcher: () => null,
}));
vi.mock("~/orpc/react", () => ({
  OrpcReactProvider: ({ children }: { children: ReactNode }) => children,
}));

const session = { sub: "42", id: 42, email: "a@f3.test", roles: [] };

function contains(node: unknown, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => contains(child, type));
  if (!isValidElement(node)) return false;
  const element = node as ReactElement<{ children?: unknown }>;
  return element.type === type || contains(element.props.children, type);
}

async function renderLayout(pathname: string | null) {
  headersMock.mockResolvedValue(
    new Headers(pathname ? { "x-admin-pathname": pathname } : {}),
  );
  const { default: RootLayout } = await import("~/app/layout");
  return RootLayout({ children: <main>portal</main> });
}

describe("RootLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the outage screen instead of the access check when the API is unavailable", async () => {
    getSessionLookupMock.mockResolvedValue({ session, apiUnavailable: true });

    const tree = await renderLayout("/users");

    expect(contains(tree, ApiUnavailable)).toBe(true);
    expect(requireAdminPortalAccessMock).not.toHaveBeenCalled();
  });

  it("runs the access check and renders the portal when the API is up", async () => {
    getSessionLookupMock.mockResolvedValue({ session, apiUnavailable: false });

    const tree = await renderLayout("/users");

    expect(contains(tree, ApiUnavailable)).toBe(false);
    expect(requireAdminPortalAccessMock).toHaveBeenCalledWith(session);
  });

  it("still renders public pages when the API is unavailable", async () => {
    getSessionLookupMock.mockResolvedValue({ session, apiUnavailable: true });

    const tree = await renderLayout(null);

    expect(contains(tree, ApiUnavailable)).toBe(false);
    expect(requireAdminPortalAccessMock).not.toHaveBeenCalled();
  });
});
