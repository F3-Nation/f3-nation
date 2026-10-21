// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock: { AUTH_USE_BETTER_AUTH: boolean; APPS_DIRECTORY_URL?: string } =
  { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/current-session", () => ({
  getCurrentSession: vi.fn(async () => ({
    user: { name: "PermVac", email: "permvac@example.com" },
  })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("~/app/components/SignOutButton", () => ({ default: () => null }));

const { default: HomePage } = await import("~/app/page");

async function renderHome() {
  render(await HomePage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  delete envMock.APPS_DIRECTORY_URL;
});
afterEach(cleanup);

describe("signed-in home page apps directory link", () => {
  it("links to apps.f3nation.com when nothing is configured", async () => {
    await renderHome();

    const link = screen.getByRole("link", { name: "apps.f3nation.com" });
    expect(link.getAttribute("href")).toBe("https://apps.f3nation.com/");
  });

  it("links to a configured directory", async () => {
    envMock.APPS_DIRECTORY_URL = "https://staging.apps.f3nation.com";

    await renderHome();

    const link = screen.getByRole("link", {
      name: "staging.apps.f3nation.com",
    });
    expect(link.getAttribute("href")).toBe(
      "https://staging.apps.f3nation.com/",
    );
  });

  it("hides the link when set to off", async () => {
    envMock.APPS_DIRECTORY_URL = "off";

    await renderHome();

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/explore the F3 Nation ecosystem/)).toBeNull();
  });

  it("hides the link instead of erroring on a bad value", async () => {
    envMock.APPS_DIRECTORY_URL = "javascript:alert(1)";

    await renderHome();

    expect(screen.getByText("F3 Nation Auth")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
