import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import RouteError from "~/app/error";
import GlobalError from "~/app/global-error";
import Loading from "~/app/loading";
import NotFound from "~/app/not-found";
import UserLoading from "~/app/users/[id]/loading";

vi.mock("~/app/admin-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

function withDigest(digest: string) {
  return Object.assign(new Error("boom"), { digest });
}

describe("admin route boundaries", () => {
  afterEach(cleanup);

  it("error.tsx shows the digest and never the message", () => {
    render(<RouteError error={withDigest("abc123")} retry={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("abc123");
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it.each([
    new Error("no digest"),
    "a string",
    null,
    { digest: "not-an-error" },
  ])("error.tsx hides the reference for %o", (error) => {
    render(<RouteError error={error} retry={vi.fn()} />);
    expect(screen.queryByText(/Reference/)).toBeNull();
  });

  it("error.tsx hides a non-string digest", () => {
    render(
      <RouteError
        error={withDigest(42 as unknown as string)}
        retry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Reference/)).toBeNull();
  });

  it("error.tsx calls retry from Try again", () => {
    const retry = vi.fn();
    render(<RouteError error={new Error("x")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("not-found.tsx links home", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("Page not found");
    expect(html).toContain('href="/"');
  });

  it("global-error.tsx renders its own document", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={withDigest("d1")} retry={vi.fn()} />,
    );
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("d1");
  });

  it("loading.tsx renders a table skeleton", () => {
    render(<Loading />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getAllByRole("row")).toHaveLength(11);
  });

  it("users/[id]/loading.tsx renders a form skeleton", () => {
    render(<UserLoading />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
  });
});
