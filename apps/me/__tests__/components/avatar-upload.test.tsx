import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AvatarUpload } from "@/components/avatar-upload";

// Radix Avatar preloads the src with `new window.Image()` and only renders the
// <img> once it has loaded. jsdom never loads images, so stand in an Image that
// is complete right away and counts as broken when its src contains "broken".
class FakeImage extends EventTarget {
  src = "";
  referrerPolicy = "";
  crossOrigin: string | null = null;
  get complete() {
    return this.src !== "";
  }
  get naturalWidth() {
    return this.src.includes("broken") ? 0 : 100;
  }
}

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => undefined;

function renderAvatar(props: {
  currentUrl?: string | null;
  fallbackName?: string;
}) {
  return render(
    <AvatarUpload
      currentUrl={props.currentUrl ?? null}
      fallbackName={props.fallbackName}
      onUploaded={noop}
    />,
  );
}

describe("AvatarUpload", () => {
  it("shows the uppercased first letter of the trimmed name", () => {
    renderAvatar({ fallbackName: "  salsa " });
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("shows F when the name is blank", () => {
    renderAvatar({ fallbackName: "   " });
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("shows F when there is no name", () => {
    renderAvatar({});
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("shows the image instead of the initial once it loads", () => {
    const { container } = renderAvatar({
      currentUrl: "https://example.com/avatar.jpg",
      fallbackName: "Salsa",
    });
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/avatar.jpg",
    );
    expect(screen.queryByText("S")).not.toBeInTheDocument();
  });

  it("falls back to the initial when the image fails, then shows a new image", () => {
    const { container, rerender } = renderAvatar({
      currentUrl: "https://example.com/broken.jpg",
      fallbackName: "Salsa",
    });
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();

    rerender(
      <AvatarUpload
        currentUrl="https://example.com/new.jpg"
        fallbackName="Salsa"
        onUploaded={noop}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/new.jpg",
    );
    expect(screen.queryByText("S")).not.toBeInTheDocument();
  });
});
