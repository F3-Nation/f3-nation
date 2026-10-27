import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { renderToStaticMarkup } from "react-dom/server";
import RouteError from "../../src/app/error";
import NotFound from "../../src/app/not-found";

const captureExceptionMock = vi.hoisted(() => vi.fn());
const envMock = vi.hoisted(
  (): { NEXT_PUBLIC_POSTHOG_KEY: string | undefined } => ({
    NEXT_PUBLIC_POSTHOG_KEY: "test-key",
  }),
);

vi.mock("posthog-js", () => ({
  default: { captureException: captureExceptionMock },
}));

vi.mock("~/env", () => ({
  env: envMock,
}));

describe("RouteError", () => {
  const retry = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  });

  it("reports client-thrown errors", () => {
    const error = new Error("client");
    render(<RouteError error={error} retry={retry} />);
    expect(captureExceptionMock).toHaveBeenCalledWith(error);
  });

  it("reports thrown non-Error values", () => {
    render(<RouteError error="oops" retry={retry} />);
    expect(captureExceptionMock).toHaveBeenCalledWith("oops");
  });

  it("skips server errors already captured by onRequestError", () => {
    const error = Object.assign(new Error("server"), { digest: "d1" });
    render(<RouteError error={error} retry={retry} />);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("d1");
  });

  it("does not report when PostHog is not initialized", () => {
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    render(<RouteError error={new Error("client")} retry={retry} />);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("shows the outage screen, unreported, when the API is unavailable", () => {
    render(
      <RouteError
        error={new ORPCError("SERVICE_UNAVAILABLE", { status: 503 })}
        retry={retry}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "The F3 Nation map is temporarily unavailable",
      }),
    ).toBeTruthy();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("shows the outage screen but still reports an API 500, which may be a bug", () => {
    const error = new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 });
    render(<RouteError error={error} retry={retry} />);
    expect(screen.getByText(/temporarily unavailable/)).toBeTruthy();
    expect(captureExceptionMock).toHaveBeenCalledWith(error);
  });

  it("keeps the generic error screen for an API error that isn't an outage", () => {
    const error = new ORPCError("BAD_REQUEST", { status: 400 });
    render(<RouteError error={error} retry={retry} />);
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(error);
  });

  it("calls retry from Try again", () => {
    render(<RouteError error={new Error("client")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("NotFound", () => {
  it("fits the overflow-hidden map viewport", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("Page not found");
    expect(html).toContain("h-dvh");
  });
});
