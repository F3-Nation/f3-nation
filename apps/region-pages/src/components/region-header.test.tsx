import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RegionHeader } from "@/components/region-header";

describe("RegionHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("links the website and every provided contact channel", () => {
    render(
      <RegionHeader
        regionName="Boone"
        website="https://f3boone.com"
        email="boone@example.com"
        facebook="https://facebook.com/f3boone"
        twitter="https://x.com/f3boone"
        instagram="https://instagram.com/f3boone"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Visit Region Website" }),
    ).toHaveAttribute("href", "https://f3boone.com");
    expect(screen.getByTitle("F3 Boone Email")).toHaveAttribute(
      "href",
      "mailto:boone@example.com",
    );
    expect(screen.getByTitle("F3 Boone Facebook")).toHaveAttribute(
      "href",
      "https://facebook.com/f3boone",
    );
    expect(screen.getByTitle("F3 Boone X")).toHaveAttribute(
      "href",
      "https://x.com/f3boone",
    );
    expect(screen.getByTitle("F3 Boone Instagram")).toHaveAttribute(
      "href",
      "https://instagram.com/f3boone",
    );
  });

  it("renders no links when the region has no contact info", () => {
    render(<RegionHeader regionName="Boone" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
