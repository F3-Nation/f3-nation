import { describe, expect, it } from "vitest";

import type { CacheEntry } from "./cache";
import {
  buildRegionRedirectUrl,
  buildStatsRedirectUrl,
  isStatsHostname,
  resolveRedirect,
} from "./redirect-resolver";

const entry = (hostname: string, slug: string, id: string): CacheEntry => ({
  id: `uuid-${slug}`,
  hostname,
  regionSlug: slug,
  regionId: id,
  lifecycleState: "active",
});

function fakeCache(rows: CacheEntry[]) {
  const map = new Map<string, CacheEntry>();
  for (const row of rows) {
    map.set(row.hostname.toLowerCase(), row);
  }
  return (hostname: string) => map.get(hostname.toLowerCase()) ?? null;
}

describe("isStatsHostname", () => {
  it("returns true for the stats. prefix", () => {
    expect(isStatsHostname("stats.f3marshall.com")).toBe(true);
    expect(isStatsHostname("STATS.F3MARSHALL.COM")).toBe(true);
  });

  it("returns false for apex", () => {
    expect(isStatsHostname("f3marshall.com")).toBe(false);
    expect(isStatsHostname("www.f3marshall.com")).toBe(false);
  });
});

describe("buildRegionRedirectUrl / buildStatsRedirectUrl", () => {
  it("produces the legacy apps/web target", () => {
    expect(buildRegionRedirectUrl("f3marshall")).toBe(
      "https://regions.f3nation.com/f3marshall",
    );
  });

  it("produces the legacy apps/stats target", () => {
    expect(buildStatsRedirectUrl("42")).toBe(
      "https://pax-vault.f3nation.com/stats/region/42",
    );
  });
});

describe("resolveRedirect", () => {
  it("resolves apex host to a 307 region redirect", () => {
    const cache = fakeCache([entry("f3marshall.com", "f3marshall", "1")]);
    const result = resolveRedirect("f3marshall.com", "/", cache);
    expect(result).toEqual({
      kind: "apex_redirect",
      target: "https://regions.f3nation.com/f3marshall",
      statusCode: 307,
      hostname: "f3marshall.com",
      isStatsHost: false,
    });
  });

  it("resolves stats. host to a 307 stats redirect", () => {
    const cache = fakeCache([
      entry("stats.f3marshall.com", "f3marshall", "42"),
    ]);
    const result = resolveRedirect("stats.f3marshall.com", "/", cache);
    expect(result).toEqual({
      kind: "stats_redirect",
      target: "https://pax-vault.f3nation.com/stats/region/42",
      statusCode: 307,
      hostname: "stats.f3marshall.com",
      isStatsHost: true,
    });
  });

  it("unknown host returns 404 unknown_host (caller falls back)", () => {
    const cache = fakeCache([]);
    const result = resolveRedirect("nope.example.com", "/", cache);
    expect(result.kind).toBe("unknown_host");
    expect(result.statusCode).toBe(404);
    expect(result.target).toBeUndefined();
  });

  it("is case-insensitive on the host header", () => {
    const cache = fakeCache([entry("f3marshall.com", "f3marshall", "1")]);
    const result = resolveRedirect("F3MARSHALL.COM", "/pax", cache);
    expect(result.kind).toBe("apex_redirect");
    expect(result.target).toBe("https://regions.f3nation.com/f3marshall");
    expect(result.hostname).toBe("f3marshall.com");
  });

  it("tolerates a trailing dot on the host header", () => {
    const cache = fakeCache([entry("f3marshall.com", "f3marshall", "1")]);
    const result = resolveRedirect("f3marshall.com.", "/", cache);
    expect(result.kind).toBe("apex_redirect");
    expect(result.hostname).toBe("f3marshall.com");
  });

  it("disambiguates stats. vs apex when both exist", () => {
    const cache = fakeCache([
      entry("f3marshall.com", "f3marshall", "1"),
      entry("stats.f3marshall.com", "f3marshall", "1"),
    ]);
    expect(resolveRedirect("f3marshall.com", "/", cache).kind).toBe(
      "apex_redirect",
    );
    expect(resolveRedirect("stats.f3marshall.com", "/", cache).kind).toBe(
      "stats_redirect",
    );
  });

  it("stats. host with no cache row is still unknown_host (fails open)", () => {
    const cache = fakeCache([]);
    const result = resolveRedirect("stats.unknown.example.com", "/", cache);
    expect(result.kind).toBe("unknown_host");
    expect(result.isStatsHost).toBe(true);
  });

  it("localhost returns unknown_host by default (local dev smoke)", () => {
    const cache = fakeCache([]);
    expect(resolveRedirect("localhost", "/", cache).kind).toBe("unknown_host");
    expect(resolveRedirect("localhost:3005", "/", cache).kind).toBe(
      "unknown_host",
    );
  });

  it("localhost with a seeded cache entry resolves (dev ergonomics)", () => {
    const cache = fakeCache([entry("localhost", "devregion", "999")]);
    const result = resolveRedirect("localhost", "/", cache);
    expect(result.kind).toBe("apex_redirect");
    expect(result.target).toBe("https://regions.f3nation.com/devregion");
  });

  it("path parameter is accepted and does not affect the target", () => {
    const cache = fakeCache([entry("f3marshall.com", "f3marshall", "1")]);
    const a = resolveRedirect("f3marshall.com", "/", cache);
    const b = resolveRedirect("f3marshall.com", "/some/deep/path", cache);
    expect(a.target).toBe(b.target);
  });
});
