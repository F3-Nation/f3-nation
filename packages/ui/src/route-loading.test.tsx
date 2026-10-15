import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RouteLoading } from "./route-loading";

afterEach(cleanup);

describe("RouteLoading", () => {
  it("announces the pending state to assistive tech", () => {
    render(<RouteLoading />);

    expect(screen.getByRole("status").textContent).toContain("Loading");
  });

  it("hides the decorative spinner from the accessibility tree", () => {
    const { container } = render(<RouteLoading />);
    const spinner = container.querySelector("svg");

    expect(spinner?.closest("[aria-hidden='true']")).not.toBeNull();
  });
});
