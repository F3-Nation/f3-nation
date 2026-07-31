import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GlobalError from "../src/app/global-error";

const captureExceptionMock = vi.hoisted(() => vi.fn());
const posthogMock = vi.hoisted(() => ({
  __loaded: true,
  captureException: captureExceptionMock,
}));

vi.mock("posthog-js", () => ({
  default: posthogMock,
}));

describe("GlobalError", () => {
  const mockError = new Error("Test error");
  const mockReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
    posthogMock.__loaded = false;
    try {
      render(<GlobalError error={mockError} reset={mockReset} />);
      expect(captureExceptionMock).not.toHaveBeenCalled();
    } finally {
      posthogMock.__loaded = true;
    }
  });
});
