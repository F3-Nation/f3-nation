// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as OrgHierarchy from "@acme/shared/app/org-hierarchy";
import { readLevelFromUrl, readOrgIdFromUrl, writeUrlState } from "./url-state";

// An admin-only rename must not change public links.
vi.mock("@acme/shared/app/org-hierarchy", async (importOriginal) => {
  const actual = await importOriginal<typeof OrgHierarchy>();
  return {
    ...actual,
    orgTypeDisplay: {
      ...actual.orgTypeDisplay,
      region: { ...actual.orgTypeDisplay.region, routeSegment: "org-regions" },
    },
  };
});

const originalReplaceState = window.history.replaceState.bind(window.history);

function setSearch(qs: string) {
  originalReplaceState(null, "", qs || "./");
}

beforeEach(() => {
  setSearch("");
  window.history.replaceState = originalReplaceState;
});

afterEach(() => {
  window.history.replaceState = originalReplaceState;
});

describe("readLevelFromUrl", () => {
  it.each(["ao", "aos", "nation", "nations", "the-nation"])(
    "ignores non-navigable level %s",
    (level) => {
      setSearch(`?level=${level}`);
      expect(readLevelFromUrl()).toBeNull();
    },
  );

  it("keeps public links stable when an admin route changes", () => {
    writeUrlState("region", 42);
    expect(new URLSearchParams(window.location.search).get("level")).toBe(
      "regions",
    );
    expect(readLevelFromUrl()).toBe("region");
    setSearch("?level=org-regions");
    expect(readLevelFromUrl()).toBeNull();
  });

  it("returns null when no level param", () => {
    setSearch("");
    expect(readLevelFromUrl()).toBeNull();
  });

  it("reads named plural form", () => {
    setSearch("?level=areas");
    expect(readLevelFromUrl()).toBe("area");
  });

  it("reads named singular form (backward compat)", () => {
    setSearch("?level=sector");
    expect(readLevelFromUrl()).toBe("sector");
  });

  it("ignores a numeric level param (no legacy support)", () => {
    setSearch("?level=2");
    expect(readLevelFromUrl()).toBeNull();
  });

  it("returns null for unrecognized level name", () => {
    setSearch("?level=districts");
    expect(readLevelFromUrl()).toBeNull();
  });
});

describe("readOrgIdFromUrl", () => {
  it("returns null when no org param", () => {
    setSearch("");
    expect(readOrgIdFromUrl()).toBeNull();
  });

  it("returns the org id as a number", () => {
    setSearch("?org=42");
    expect(readOrgIdFromUrl()).toBe(42);
  });

  it("returns null for non-numeric org param", () => {
    setSearch("?org=abc");
    expect(readOrgIdFromUrl()).toBeNull();
  });
});

describe("writeUrlState", () => {
  it("omits level param when sector (default)", () => {
    setSearch("?level=regions&org=42");
    writeUrlState("sector", null);
    expect(window.location.search).toBe("");
  });

  it("writes plural level param for non-sector levels", () => {
    let lastUrl = "";
    window.history.replaceState = (_s: unknown, _t: string, url: string) => {
      lastUrl = url;
    };
    writeUrlState("area", null);
    expect(lastUrl).toContain("level=areas");
  });

  it("includes org id when provided", () => {
    let lastUrl = "";
    window.history.replaceState = (_s: unknown, _t: string, url: string) => {
      lastUrl = url;
    };
    writeUrlState("region", 123);
    expect(lastUrl).toContain("org=123");
    expect(lastUrl).toContain("level=regions");
  });

  it("writes ./ when level is sector and no org", () => {
    let lastUrl = "";
    window.history.replaceState = (_s: unknown, _t: string, url: string) => {
      lastUrl = url;
    };
    writeUrlState("sector", null);
    expect(lastUrl).toBe("./");
  });
});
