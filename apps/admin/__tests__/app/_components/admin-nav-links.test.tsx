import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminNavLinks } from "~/app/_components/admin-nav-links";

const auth = vi.hoisted(() => ({ isNationAdmin: false }));
vi.mock("~/utils/hooks/use-auth", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/oauth-clients" }));

afterEach(cleanup);

it.each([false, true])(
  "keeps organization navigation and gates OAuth clients with nationAdmin=%s",
  (isNationAdmin) => {
    auth.isNationAdmin = isNationAdmin;
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
