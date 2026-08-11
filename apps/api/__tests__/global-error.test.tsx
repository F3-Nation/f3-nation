import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GlobalError from "../src/app/global-error";

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

describe("GlobalError", () => {
  const mockError = new Error("Test error");
  const mockReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  });

  it("renders the error heading and reset button", () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("calls reset when the button is clicked", () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockReset).toHaveBeenCalledOnce();
  });

  it("reports the error to PostHog on mount", () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    expect(captureExceptionMock).toHaveBeenCalledWith(mockError);
  });

  it("does not report when PostHog is not initialized", () => {
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    render(<GlobalError error={mockError} reset={mockReset} />);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("does not throw when captureException itself throws (last-resort UI, no boundary above it)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error("ingest host blocked");
    });
    expect(() =>
      render(<GlobalError error={mockError} reset={mockReset} />),
    ).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "posthog.capture_exception_failed",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });
});
