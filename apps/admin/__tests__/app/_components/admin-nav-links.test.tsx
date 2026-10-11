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

it.each([false, true])(
  "keeps organization navigation and gates OAuth clients with nationAdmin=%s",
  (isNationAdmin) => {
    auth.isNationAdmin = isNationAdmin;
    auth.isAdmin = isNationAdmin;
    const view = render(<AdminNavLinks mapUrl="https://map.example.invalid" />);
    expect(view.container.querySelector('a[href="/regions"]')).not.toBeNull();
    expect(view.container.querySelector('a[href="/aos"]')).not.toBeNull();

    const oauth = screen.queryByRole("link", { name: "OAuth Clients" });
    if (isNationAdmin) {
      expect(oauth?.getAttribute("href")).toBe("/oauth-clients");
      expect(oauth?.className).toContain("bg-muted");
      for (const href of ["/the-nation", "/sectors", "/areas"]) {
        expect(
          view.container.querySelector(`a[href="${href}"]`),
        ).not.toBeNull();
      }
    } else {
      expect(oauth).toBeNull();
    }
  },
);

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
