import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { OrgInfoPanel } from "./org-info-panel";
import type { Org, OrgDetail, OrgMetrics } from "../_lib/types";

const baseOrg: Org = {
  id: 1,
  parentId: null,
  name: "Test Nation",
  orgType: "nation",
};

const baseDetail: OrgDetail = {
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
  roles: [],
};

const baseMetrics: OrgMetrics = { events: 10, aos: 5, locations: 3 };

describe("OrgInfoPanel", () => {
  it("renders idle state prompt", () => {
    const html = renderToStaticMarkup(<OrgInfoPanel status="idle" />);
    expect(html).toContain("Click or hover");
  });

  it("renders loading state with org name", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loading" org={baseOrg} />,
    );
    expect(html).toContain("Test Nation");
    expect(html).toContain("Loading");
  });

  it("renders error state", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="error" org={baseOrg} />,
    );
    expect(html).toContain("Test Nation");
    expect(html).toContain("Failed to load");
  });

  it("renders loaded state with org name and type", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel
        status="loaded"
        org={baseOrg}
        detail={baseDetail}
        aggregatedMetrics={baseMetrics}
      />,
    );
    expect(html).toContain("Test Nation");
    expect(html).toContain("NATION");
  });

  it("renders email as mailto link", () => {
    const detail = { ...baseDetail, email: "info@f3.test" };
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loaded" org={baseOrg} detail={detail} />,
    );
    expect(html).toContain("info@f3.test");
    expect(html).toContain("mailto:");
  });

  it("renders social links when present", () => {
    const detail = {
      ...baseDetail,
      website: "https://f3.test",
      twitter: "https://twitter.com/f3",
    };
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loaded" org={baseOrg} detail={detail} />,
    );
    expect(html).toContain("https://f3.test");
    expect(html).toContain("https://twitter.com/f3");
  });

  it("renders positions list", () => {
    const detail = {
      ...baseDetail,
      positions: [
        {
          positionId: 1,
          title: "Site Q",
          userId: 42,
          f3Name: "Spartan",
          avatarUrl: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loaded" org={baseOrg} detail={detail} />,
    );
    expect(html).toContain("Site Q");
    expect(html).toContain("Spartan");
  });

  it("renders 'No positions listed' when positions is empty", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loaded" org={baseOrg} detail={baseDetail} />,
    );
    expect(html).toContain("No positions listed");
  });

  it("renders 'No admins listed' when roles empty and no nearestAdminOrg", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loaded" org={baseOrg} detail={baseDetail} />,
    );
    expect(html).toContain("No admins listed");
  });

  it("renders nearest admin org message with names when provided", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel
        status="loaded"
        org={baseOrg}
        detail={baseDetail}
        nearestAdminOrg={{
          name: "F3 Charlotte",
          orgType: "area",
          adminNames: ["Spartan", "Hammer"],
        }}
      />,
    );
    expect(html).toContain("Spartan");
    expect(html).toContain("or");
    expect(html).toContain("Hammer");
    expect(html).toContain("F3 Charlotte");
  });

  it("renders nearest admin org without names as fallback", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel
        status="loaded"
        org={baseOrg}
        detail={baseDetail}
        nearestAdminOrg={{
          name: "F3 Sector",
          orgType: "sector",
          adminNames: [],
        }}
      />,
    );
    expect(html).toContain("F3 Sector");
    expect(html).toContain("for help");
  });

  it("renders roles list", () => {
    const detail = {
      ...baseDetail,
      roles: [
        {
          roleId: 1,
          title: "Admin",
          userId: 7,
          f3Name: "Eagle",
          avatarUrl: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <OrgInfoPanel status="loaded" org={baseOrg} detail={detail} />,
    );
    expect(html).toContain("Admin");
    expect(html).toContain("Eagle");
  });

  it("renders sector counts for nation", () => {
    const html = renderToStaticMarkup(
      <OrgInfoPanel
        status="loaded"
        org={baseOrg}
        detail={baseDetail}
        descendantOrgs={[
          { id: 2, parentId: 1, name: "S1", orgType: "sector" },
          { id: 3, parentId: 1, name: "S2", orgType: "sector" },
        ]}
        aggregatedMetrics={baseMetrics}
      />,
    );
    expect(html).toContain("Sectors:");
  });

  it("renders footprint for region", () => {
    const regionOrg: Org = {
      id: 10,
      parentId: 1,
      name: "Test Region",
      orgType: "region",
    };
    const regionDetail = {
      ...baseDetail,
      id: 10,
      name: "Test Region",
      orgType: "region" as const,
    };
    const html = renderToStaticMarkup(
      <OrgInfoPanel
        status="loaded"
        org={regionOrg}
        detail={regionDetail}
        aggregatedMetrics={baseMetrics}
        footprintSqMi={1234.5}
      />,
    );
    expect(html).toContain("1,234.5");
    expect(html).toContain("sq mi");
  });
});
