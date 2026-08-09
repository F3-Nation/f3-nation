import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ApiDownSplash } from "~/app/_components/api-down-splash";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const reloadMock = vi.fn();
Object.defineProperty(window, "location", {
  value: { ...window.location, reload: reloadMock },
  writable: true,
});

describe("ApiDownSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reloadMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the F3 logo, heading, message, and status link", () => {
    render(<ApiDownSplash />);
    expect(screen.getByAltText("F3 Nation")).toBeInTheDocument();
    expect(screen.getByText("Be Back Soon, PAX")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /f3nation\.com\/status/i }),
    ).toHaveAttribute("href", "https://f3nation.com/status");
  });

  it("reloads the page after 30 seconds", () => {
    render(<ApiDownSplash />);
    expect(reloadMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
