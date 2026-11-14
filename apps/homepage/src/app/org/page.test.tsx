// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real loader pulls in Leaflet, which needs a browser; the page only has
// to hand off to it.
vi.mock("./_components/org-map-loader", () => ({
  OrgMapLoader: () => "org map loader",
}));

import OrgPage, { metadata } from "./page";

afterEach(() => {
  cleanup();
});

describe("/org page", () => {
  it("renders the map loader under the directory title", () => {
    render(<OrgPage />);
    expect(screen.getByText("org map loader")).toBeTruthy();
    expect(metadata.title).toBe("F3 Geographic Directory");
  });
});
