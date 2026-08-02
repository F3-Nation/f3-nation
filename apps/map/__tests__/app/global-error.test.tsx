import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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

describe("GlobalError", () => {
  const mockError = new Error("Test error");

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  });

  it("reports the error to PostHog on mount", () => {
    render(<GlobalError error={mockError} />);
    expect(captureExceptionMock).toHaveBeenCalledWith(mockError);
  });

  it("does not report when PostHog is not initialized", () => {
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    render(<GlobalError error={mockError} />);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
