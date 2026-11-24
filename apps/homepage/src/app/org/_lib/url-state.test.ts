// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as OrgHierarchy from "@acme/shared/app/org-hierarchy";
import {
  readLevelFromUrl,
  readOrgIdFromUrl,
  readTableOrgIdsFromUrl,
  readViewFromUrl,
  readViewportFromUrl,
  writeMapFocusUrl,
  writeTableUrlState,
  writeUrlState,
  writeViewportToUrl,
} from "./url-state";

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

describe("reading the URL without a window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The static export renders this route with no window at build time.
  it("returns null for level and org", () => {
    setSearch("?level=regions&org=42");
    vi.stubGlobal("window", undefined);
    expect(readLevelFromUrl()).toBeNull();
    expect(readOrgIdFromUrl()).toBeNull();
  });
});

describe("writeUrlState", () => {
  it("keeps a saved viewport when the level or org changes", () => {
    setSearch("?level=areas&org=3&at=35.5,-80.5,10");
    writeUrlState("region", 7);
    expect(window.location.search).toBe(
      "?level=regions&org=7&at=35.5,-80.5,10",
    );
    expect(readViewportFromUrl()).toEqual({ lat: 35.5, lng: -80.5, zoom: 10 });
  });

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

describe("map viewport", () => {
  it("reads a valid ?at= center and zoom", () => {
    setSearch("?org=7&at=35.2,-80.85,9");
    expect(readViewportFromUrl()).toEqual({ lat: 35.2, lng: -80.85, zoom: 9 });
  });

  it.each([
    "",
    "?at=35.2,-80.85",
    "?at=35.2,,9",
    "?at=a,b,c",
    "?at=95,0,5",
    "?at=0,190,5",
    "?at=0,0,1",
    "?at=0,0,21",
  ])("ignores a missing or invalid viewport %s", (qs) => {
    setSearch(qs);
    expect(readViewportFromUrl()).toBeNull();
  });

  it("writes the viewport rounded, keeping org and level", () => {
    setSearch("?level=regions&org=7");
    writeViewportToUrl({ lat: 35.123456789, lng: -80.987654321, zoom: 9 });
    expect(window.location.search).toBe(
      "?level=regions&org=7&at=35.12346,-80.98765,9",
    );
    expect(readViewportFromUrl()).toEqual({
      lat: 35.12346,
      lng: -80.98765,
      zoom: 9,
    });
  });

  it("points the map at one org or at Nation", () => {
    setSearch("?view=table&orgs=2,3");
    writeMapFocusUrl(3);
    expect(window.location.search).toBe("?org=3");
    writeMapFocusUrl(null);
    expect(window.location.search).toBe("");
  });
});

describe("view and table filters", () => {
  it("defaults to the Map view", () => {
    expect(readViewFromUrl()).toBe("map");
    setSearch("?view=list");
    expect(readViewFromUrl()).toBe("map");
    setSearch("?view=table");
    expect(readViewFromUrl()).toBe("table");
  });

  it("reads checked org ids, dropping invalid and duplicate ones", () => {
    expect(readTableOrgIdsFromUrl()).toEqual([]);
    setSearch("?view=table&orgs=2,3,x,-1,3,0,4.5,5");
    expect(readTableOrgIdsFromUrl()).toEqual([2, 3, 5]);
  });

  it("writes the table view with readable commas", () => {
    setSearch("?org=7&at=1,2,3");
    writeTableUrlState([2, 3]);
    expect(window.location.search).toBe("?view=table&orgs=2,3");
    writeTableUrlState([]);
    expect(window.location.search).toBe("?view=table");
  });
});
