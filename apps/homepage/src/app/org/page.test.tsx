// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real loader lazily imports org-map, which brings in Leaflet and fetches
// the org chart from the API; the page only has to hand off to it.
vi.mock("./_components/org-map-loader", () => ({
  OrgMapLoader: () => "org map loader",
}));

import OrgPage, { metadata } from "./page";

afterEach(() => {
  cleanup();
});

describe("/org page", () => {
  it("hands off to the map loader and sets the directory title metadata", () => {
    render(<OrgPage />);
    expect(screen.getByText("org map loader")).toBeTruthy();
    expect(metadata.title).toBe("F3 Geographic Directory");
  });
});
