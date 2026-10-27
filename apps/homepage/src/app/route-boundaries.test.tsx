// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import RouteError from "@/app/error";
import GlobalError from "@/app/global-error";
import NotFound from "@/app/not-found";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@acme/observability/browser", () => ({ captureException }));

describe("homepage route boundaries", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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
    expect(renderToStaticMarkup(<NotFound />)).toContain('href="/"');
  });
});
