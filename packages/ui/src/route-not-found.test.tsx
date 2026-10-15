import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RouteNotFound } from "./route-not-found";

afterEach(cleanup);

describe("RouteNotFound", () => {
  it("links home to / by default", () => {
    render(<RouteNotFound />);

    expect(
      screen.getByRole("link", { name: "Go back home" }).getAttribute("href"),
    ).toBe("/");
  });

  it("points the home link at a custom homeHref", () => {
    render(<RouteNotFound homeHref="/admin" />);

    expect(
      screen.getByRole("link", { name: "Go back home" }).getAttribute("href"),
    ).toBe("/admin");
  });

  it("renders a custom title and description", () => {
    render(<RouteNotFound title="Gone" description="Nothing here." />);

    expect(screen.getByRole("heading").textContent).toBe("Gone");
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });
});
