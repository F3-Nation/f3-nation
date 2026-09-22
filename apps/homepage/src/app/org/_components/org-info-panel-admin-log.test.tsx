// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { OrgInfoPanel } from "./org-info-panel";
import type { Org, OrgDetail, OrgMetrics } from "../_lib/types";

const org: Org = {
  id: 1,
  parentId: null,
  name: "Test Nation",
  orgType: "nation",
};

const detail: OrgDetail = {
  id: 1,
  name: "Test Nation",
  orgType: "nation",
  email: null,
  phone: null,
  website: null,
  twitter: null,
  facebook: null,
  instagram: null,
  positions: [],
  roles: [
    { roleId: 5, title: "Admin", userId: 7, f3Name: "Eagle", avatarUrl: null },
  ],
};

const metrics: OrgMetrics = { events: 0, aos: 0, locations: 0 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OrgInfoPanel admin console lookups", () => {
  it("logs org identifiers when the org title is clicked", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    render(
      <OrgInfoPanel
        status="loaded"
        org={org}
        detail={detail}
        aggregatedMetrics={metrics}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test Nation" }));
    expect(spy).toHaveBeenCalledWith(
      "[org-chart] org",
      expect.objectContaining({ id: 1, orgType: "nation" }),
    );
  });

  it("logs leader identifiers when a leader is clicked", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    render(
      <OrgInfoPanel
        status="loaded"
        org={org}
        detail={detail}
        aggregatedMetrics={metrics}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Eagle/ }));
    expect(spy).toHaveBeenCalledWith(
      "[org-chart] leader",
      expect.objectContaining({ userId: 7, roleId: 5 }),
    );
  });
});
