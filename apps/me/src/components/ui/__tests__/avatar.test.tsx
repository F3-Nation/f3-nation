import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar } from "../avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("shows the fallback after an image error and retries when src changes", () => {
    const { rerender } = render(
      <Avatar src="https://x.test/a.png" alt="me" fallback="Dredd" />,
    );
    const img = screen.getByAltText("me");
    expect(img.getAttribute("src")).toContain("a.png");

    fireEvent.error(img);
    expect(screen.getByAltText("me").getAttribute("src")).toContain(
      "data:image/svg+xml",
    );

    rerender(<Avatar src="https://x.test/b.png" alt="me" fallback="Dredd" />);
    expect(screen.getByAltText("me").getAttribute("src")).toContain("b.png");
  });
});
