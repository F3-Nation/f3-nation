import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRetryDelayMs } from "@acme/shared/app/api-availability";
import { ApiUnavailable } from "@/components/api-unavailable";

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span>{props.alt}</span>,
}));

// The delay with Math.random pinned to 0.5 below, from the real function.
const RETRY_MS = apiRetryDelayMs(() => 0.5);

describe("ApiUnavailable", () => {
  const reload = vi.fn();
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    reload.mockClear();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    vi.stubGlobal("location", { ...window.location, reload });
    // Pin the jitter so the timer fires at exactly the base delay.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("explains the outage", () => {
    render(<ApiUnavailable />);
    expect(
      screen.getByRole("heading", { name: /temporarily unavailable/i }),
    ).toBeDefined();
  });

  it("reloads after the retry delay while visible", () => {
    render(<ApiUnavailable />);

    vi.advanceTimersByTime(RETRY_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("skips the reload while hidden and retries once visible", () => {
    visibility = "hidden";
    render(<ApiUnavailable />);

    vi.advanceTimersByTime(RETRY_MS * 3);
    expect(reload).not.toHaveBeenCalled();

    visibility = "visible";
    vi.advanceTimersByTime(RETRY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once unmounted", () => {
    const { unmount } = render(<ApiUnavailable />);
    unmount();

    vi.advanceTimersByTime(RETRY_MS * 2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads immediately on Try again", () => {
    render(<ApiUnavailable />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
