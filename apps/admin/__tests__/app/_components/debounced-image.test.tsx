import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DebouncedImage } from "~/app/_components/debounced-image";

const noop = () => undefined;

const renderImage = (src?: string) => (
  <DebouncedImage
    src={src}
    alt="Logo"
    onImageFail={noop}
    onImageSuccess={noop}
  />
);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DebouncedImage", () => {
  it("shows the placeholder until src has been stable for a second", () => {
    const { container } = render(renderImage("https://example.com/a.png"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
  });

  it("hides the old image while a new src settles", () => {
    const { container, rerender } = render(
      renderImage("https://example.com/a.png"),
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    rerender(renderImage("https://example.com/b.png"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.queryByRole("img")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "https://example.com/b.png",
    );
  });
});
