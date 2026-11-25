import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AdminNavLinks } from "~/app/_components/admin-nav-links";

const auth = vi.hoisted(() => ({ isAdmin: false, isNationAdmin: false }));
vi.mock("~/utils/hooks/use-auth", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/oauth-clients" }));

afterEach(cleanup);
beforeEach(() => {
  auth.isAdmin = false;
  auth.isNationAdmin = false;
});

const renderNavAs = (isNationAdmin: boolean) => {
  auth.isNationAdmin = isNationAdmin;
  auth.isAdmin = isNationAdmin;
  const view = render(<AdminNavLinks mapUrl="https://map.example.invalid" />);
  expect(view.container.querySelector('a[href="/regions"]')).not.toBeNull();
  expect(view.container.querySelector('a[href="/aos"]')).not.toBeNull();
  return view;
};

it("keeps organization navigation and hides OAuth clients with nationAdmin=false", () => {
  renderNavAs(false);

  expect(screen.queryByRole("link", { name: "OAuth Clients" })).toBeNull();
});

it("keeps organization navigation and shows OAuth clients with nationAdmin=true", () => {
  const view = renderNavAs(true);

  const oauth = screen.getByRole("link", { name: "OAuth Clients" });
  expect(oauth.getAttribute("href")).toBe("/oauth-clients");
  expect(oauth.className).toContain("bg-muted");
  for (const href of ["/the-nation", "/sectors", "/areas"]) {
    expect(view.container.querySelector(`a[href="${href}"]`)).not.toBeNull();
  }
});

it("hides API Keys from editors while preserving other navigation", () => {
  render(<AdminNavLinks mapUrl="https://map.example.invalid" />);

  expect(screen.queryByRole("link", { name: "API Keys" })).toBeNull();
  expect(screen.getByRole("link", { name: "Events" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Map" })).toBeTruthy();
});

it.each([
  { role: "region admin", isNationAdmin: false },
  { role: "Nation admin", isNationAdmin: true },
])("shows API Keys for a $role", ({ isNationAdmin }) => {
  auth.isAdmin = true;
  auth.isNationAdmin = isNationAdmin;
  render(<AdminNavLinks mapUrl="https://map.example.invalid" />);

  expect(
    screen.getByRole("link", { name: "API Keys" }).getAttribute("href"),
  ).toBe("/api-keys");
  expect(Boolean(screen.queryByRole("link", { name: "OAuth Clients" }))).toBe(
    isNationAdmin,
  );
});

it("renders internal routes as same-tab links to their admin paths", () => {
  render(<AdminNavLinks mapUrl="https://map.example.invalid" />);

  for (const [name, href] of [
    ["All Users", "/users/all"],
    ["My Users", "/users/mine"],
    ["Events", "/workouts"],
    ["Locations", "/locations"],
  ] as const) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(href);
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  }
});

it("opens the Map in a new tab at its external URL", () => {
  render(<AdminNavLinks mapUrl="https://map.example.invalid/region" />);

  const map = screen.getByRole("link", { name: "Map" });
  expect(map.getAttribute("href")).toBe("https://map.example.invalid/region");
  expect(map.getAttribute("target")).toBe("_blank");
  expect(map.getAttribute("rel")).toBe("noopener noreferrer");
});
