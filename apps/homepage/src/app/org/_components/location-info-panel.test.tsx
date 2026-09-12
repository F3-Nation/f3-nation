// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";

import { LocationInfoPanel } from "./location-info-panel";
import type { LocationDetail } from "../_lib/types";

afterEach(cleanup);

const detail: LocationDetail = {
  locationId: 5,
  locationName: "The Yard",
  latitude: 35.5,
  longitude: -80.5,
  aos: [
    {
      id: 1,
      name: "Bootcamp",
      email: "ao@example.com",
      website: "https://ao.example.com",
      twitter: "https://x.com/ao",
      facebook: "https://facebook.com/ao",
      instagram: "https://instagram.com/ao",
      logoUrl: null,
      eventCount: 2,
      positions: [
        {
          positionId: 7,
          title: "Site Q",
          userId: 42,
          f3Name: "Splinter",
          avatarUrl: "https://example.com/a.png",
        },
        // No avatar and no f3Name — exercises the UNKNOWN_AVATAR + "Unknown" fallbacks.
        { title: "Q", userId: 99, f3Name: null, avatarUrl: null },
      ],
    },
    // Minimal AO: unnamed, no socials/email/positions, singular event count.
    {
      id: 2,
      name: null,
      email: null,
      website: null,
      twitter: null,
      facebook: null,
      instagram: null,
      logoUrl: null,
      eventCount: 1,
      positions: [],
    },
  ],
};

describe("LocationInfoPanel", () => {
  it("shows a fallback title from the id while loading", () => {
    render(<LocationInfoPanel status="loading" locationId={9} />);
    expect(screen.getByText("Location 9")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the location name and an error message on error", () => {
    render(<LocationInfoPanel status="error" locationId={5} detail={detail} />);
    expect(screen.getByText("The Yard")).toBeTruthy();
    expect(screen.getByText("Failed to load details.")).toBeTruthy();
  });

  it("shows an empty message when loaded with no AOs", () => {
    render(
      <LocationInfoPanel
        status="loaded"
        locationId={5}
        detail={{ ...detail, aos: [] }}
      />,
    );
    expect(screen.getByText("No active AOs here.")).toBeTruthy();
  });

  it("falls back to the id title when loaded without detail", () => {
    render(<LocationInfoPanel status="loaded" locationId={3} />);
    expect(screen.getByText("Location 3")).toBeTruthy();
  });

  it("renders AO cards with socials, positions, and event counts", () => {
    const { container } = render(
      <LocationInfoPanel status="loaded" locationId={5} detail={detail} />,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Bootcamp");
    expect(text).toContain("Unnamed AO");
    expect(text).toContain("2 events");
    expect(text).toContain("1 event");
    expect(text).toContain("ao@example.com");
    expect(text).toContain("Splinter");
    expect(text).toContain("Unknown");

    // All four social links render with their accessible labels.
    expect(screen.getByLabelText("Website")).toBeTruthy();
    expect(screen.getByLabelText("X (Twitter)")).toBeTruthy();
    expect(screen.getByLabelText("Facebook")).toBeTruthy();
    expect(screen.getByLabelText("Instagram")).toBeTruthy();

    // The position without an avatar uses the inline UNKNOWN_AVATAR data URI.
    const avatars = container.querySelectorAll("img");
    expect(
      Array.from(avatars).some((img) =>
        img.getAttribute("src")?.startsWith("data:image/svg+xml"),
      ),
    ).toBe(true);
  });
});
