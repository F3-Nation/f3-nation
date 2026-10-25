import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import RouteError from "~/app/error";
import GlobalError from "~/app/global-error";
import Loading from "~/app/loading";
import NotFound from "~/app/not-found";
import AuthLoading from "~/app/auth/loading";
import UserLoading from "~/app/users/[id]/loading";
import { TableSkeleton } from "@acme/ui/page-skeleton";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@acme/observability/browser", () => ({ captureException }));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist-sans" } }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "geist-mono" } }));

vi.mock("~/app/admin-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

function withDigest(digest: string) {
  return Object.assign(new Error("boom"), { digest });
}

describe("admin route boundaries", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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
    expect(
      screen.getByRole("link", { name: "Go home" }).getAttribute("href"),
    ).toBe("/");
  });

  it("error.tsx reports client errors but not server errors", () => {
    const clientError = new Error("x");
    render(<RouteError error={clientError} retry={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(clientError);
    cleanup();
    captureException.mockClear();
    render(
      <RouteError
        error={Object.assign(new Error("y"), { digest: "d1" })}
        retry={vi.fn()}
      />,
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("error.tsx never shows the message when there is no digest", () => {
    render(
      <RouteError
        error={new Error("SECRET_INTERNAL_DETAIL")}
        retry={vi.fn()}
      />,
    );
    expect(document.body.textContent).not.toContain("SECRET_INTERNAL_DETAIL");
  });

  it("global-error.tsx reports every error", () => {
    const serverError = Object.assign(new Error("y"), { digest: "d1" });
    render(<GlobalError error={serverError} retry={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(serverError);
  });

  it.each([
    new Error("SECRET_INTERNAL_DETAIL"),
    Object.assign(new Error("SECRET_INTERNAL_DETAIL"), { digest: "d1" }),
  ])("global-error.tsx never shows the message (%o)", (error) => {
    const html = renderToStaticMarkup(
      <GlobalError error={error} retry={vi.fn()} />,
    );
    expect(html).not.toContain("SECRET_INTERNAL_DETAIL");
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
    expect(html).toContain("geist-sans");
    expect(html).toContain("geist-mono");
  });

  it("loading.tsx renders a table skeleton", () => {
    render(<Loading />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    const loadingRows = screen.getAllByRole("row").length;
    cleanup();
    render(<TableSkeleton />);
    expect(loadingRows).toBe(screen.getAllByRole("row").length);
  });

  it("auth/loading.tsx renders a form skeleton without the admin shell", () => {
    render(<AuthLoading />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
  });

  it("users/[id]/loading.tsx renders a form skeleton", () => {
    render(<UserLoading />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
  });
});
