// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import RouteError from "~/app/error";
import GlobalError from "~/app/global-error";
import NotFound from "~/app/not-found";

describe("auth route boundaries", () => {
  afterEach(cleanup);

  it("error.tsx shows the digest and retries", () => {
    const retry = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<RouteError error={error} retry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("abc123");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("global-error.tsx renders its own document", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={new Error("x")} retry={vi.fn()} />,
    );
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("Something went wrong");
  });

  it("not-found.tsx links home", () => {
    expect(renderToStaticMarkup(<NotFound />)).toContain('href="/"');
  });
});
