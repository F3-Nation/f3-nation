import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "../../src/app/global-error";

const captureExceptionMock = vi.hoisted(() => vi.fn());
const posthogMock = vi.hoisted(() => ({
  captureException: captureExceptionMock,
}));
const envMock = vi.hoisted(
  (): { NEXT_PUBLIC_POSTHOG_KEY: string | undefined } => ({
    NEXT_PUBLIC_POSTHOG_KEY: "test-key",
  }),
);

vi.mock("posthog-js", () => ({
  default: posthogMock,
}));

vi.mock("~/env", () => ({
  env: envMock,
}));

vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist-sans" } }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "geist-mono" } }));

describe("GlobalError", () => {
  const mockError = new Error("Test error");
  const retry = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  });

  afterEach(() => {
    // Restore spies (the console.error spy below) even when a render or
    // assertion throws mid-test — a leaked spy would swallow errors in
    // later tests.
    vi.restoreAllMocks();
  });

  it("reports the error to PostHog on mount", () => {
    render(<GlobalError error={mockError} retry={retry} />);
    expect(captureExceptionMock).toHaveBeenCalledWith(mockError);
  });

  it("reports errors that carry a digest too (unlike error.tsx)", () => {
    const serverError = Object.assign(new Error("server"), { digest: "d1" });
    render(<GlobalError error={serverError} retry={retry} />);
    expect(captureExceptionMock).toHaveBeenCalledWith(serverError);
  });

  it("does not report when PostHog is not initialized", () => {
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    render(<GlobalError error={mockError} retry={retry} />);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it.each([
    new Error("SECRET_INTERNAL_DETAIL"),
    Object.assign(new Error("SECRET_INTERNAL_DETAIL"), { digest: "d1" }),
  ])("never shows the message (%o)", (error) => {
    render(<GlobalError error={error} retry={retry} />);
    expect(screen.queryByText(/SECRET_INTERNAL_DETAIL/)).toBeNull();
  });

  it("loads the app fonts", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={mockError} retry={retry} />,
    );
    expect(html).toContain("geist-sans");
    expect(html).toContain("geist-mono");
  });

  it("renders the shared error screen with a working retry", () => {
    render(<GlobalError error={mockError} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not throw when captureException itself throws (last-resort UI, no boundary above it)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error("ingest host blocked");
    });
    expect(() =>
      render(<GlobalError error={mockError} retry={retry} />),
    ).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "posthog.capture_exception_failed",
      expect.any(Error),
    );
  });
});
