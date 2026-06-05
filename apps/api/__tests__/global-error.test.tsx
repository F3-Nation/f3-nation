import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as Sentry from "@sentry/nextjs";
import GlobalError from "../src/app/global-error";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
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

  it("reports the error to Sentry on mount", () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    expect(Sentry.captureException).toHaveBeenCalledWith(mockError);
  });
});
