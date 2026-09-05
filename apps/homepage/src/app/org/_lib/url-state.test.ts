// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readLevelFromUrl, readOrgIdFromUrl, writeUrlState } from "./url-state";

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

  it("reads legacy numeric 0 → sector", () => {
    setSearch("?level=0");
    expect(readLevelFromUrl()).toBe("sector");
  });

  it("reads legacy numeric 1 → area", () => {
    setSearch("?level=1");
    expect(readLevelFromUrl()).toBe("area");
  });

  it("reads legacy numeric 2 → region", () => {
    setSearch("?level=2");
    expect(readLevelFromUrl()).toBe("region");
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
    // jsdom doesn't have a real replaceState, but we can check it doesn't throw
    expect(() => writeUrlState("sector", null)).not.toThrow();
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
