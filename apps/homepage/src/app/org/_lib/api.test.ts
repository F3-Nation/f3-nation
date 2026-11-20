import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchOrgChart,
  fetchOrgById,
  fetchLocationById,
  fetchLeadership,
  searchAos,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe("fetchOrgChart", () => {
  it("returns the orgs array from a successful response", async () => {
    const org = {
      orgId: 1,
      name: "Nation",
      orgType: "nation",
      hierarchy: [],
      activeLocations: [],
    };
    mockFetch(200, { orgs: [org, null] }); // null entries are filtered out
    const result = await fetchOrgChart();
    expect(result).toHaveLength(1);
    expect(result[0]?.orgId).toBe(1);
  });

  it("throws on a non-ok response", async () => {
    mockFetch(500, {});
    await expect(fetchOrgChart()).rejects.toThrow("API 500");
  });
});

describe("fetchOrgById", () => {
  it("returns the org detail on success", async () => {
    const detail = {
      id: 2,
      name: "Test",
      orgType: "region",
      roles: [],
      positions: [],
    };
    mockFetch(200, detail);
    const result = await fetchOrgById(2);
    expect(result).toMatchObject({ id: 2, name: "Test" });
  });

  it("keeps only admin and editor roles and leaves the rest of the detail untouched", async () => {
    const role = (roleId: number, title: string) => ({
      roleId,
      title,
      userId: roleId,
      f3Name: `F3-${roleId}`,
      avatarUrl: null,
    });
    const nantan = {
      positionId: 9,
      title: "Nantan",
      userId: 9,
      f3Name: "Boss",
      avatarUrl: null,
    };
    mockFetch(200, {
      id: 2,
      name: "Test",
      orgType: "region",
      email: "r@example.com",
      roles: [
        role(1, "admin"),
        role(2, "editor"),
        role(3, "password_manager"),
        role(4, "password_reader"),
        role(5, "user"),
      ],
      positions: [nantan],
    });
    const result = await fetchOrgById(2);
    expect(result.roles).toEqual([role(1, "admin"), role(2, "editor")]);
    expect(result.positions).toEqual([nantan]);
    expect(result).toMatchObject({
      id: 2,
      name: "Test",
      email: "r@example.com",
    });
  });

  it("returns an empty roles list when no role is public", async () => {
    mockFetch(200, {
      id: 3,
      name: "AO",
      orgType: "ao",
      roles: [
        {
          roleId: 3,
          title: "password_manager",
          userId: 3,
          f3Name: null,
          avatarUrl: null,
        },
      ],
      positions: [],
    });
    expect((await fetchOrgById(3)).roles).toEqual([]);
  });

  it("throws on a non-ok response", async () => {
    mockFetch(404, {});
    await expect(fetchOrgById(999)).rejects.toThrow("API 404");
  });
});

describe("fetchLocationById", () => {
  it("returns the location detail and requests the location path", async () => {
    const detail = {
      locationId: 5,
      locationName: "The Yard",
      latitude: 35.5,
      longitude: -80.5,
      aos: [],
    };
    mockFetch(200, detail);
    const result = await fetchLocationById(5);
    expect(result).toMatchObject({ locationId: 5, locationName: "The Yard" });
    const url = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(url).toContain("/org-chart/location/5");
  });

  it("throws on a non-ok response", async () => {
    mockFetch(404, {});
    await expect(fetchLocationById(999)).rejects.toThrow("API 404");
  });
});

describe("searchAos", () => {
  it("requests the search path with the encoded query and returns aos", async () => {
    const aos = [
      {
        id: 1,
        name: "Bootcamp",
        regionId: 10,
        regionName: "Charlotte",
        locationId: 5,
        latitude: 35.5,
        longitude: -80.5,
        eventCount: 3,
      },
    ];
    mockFetch(200, { aos });
    const result = await searchAos("boot camp");
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Bootcamp");
    const url = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(url).toContain("/org-chart/aos?searchTerm=boot%20camp");
  });

  it("throws on a non-ok response", async () => {
    mockFetch(500, {});
    await expect(searchAos("boot")).rejects.toThrow("API 500");
  });

  it("registers an abort listener for a live signal", async () => {
    mockFetch(200, { aos: [] });
    const controller = new AbortController();
    const result = await searchAos("boot", controller.signal);
    expect(result).toEqual([]);
  });

  it("handles an already-aborted signal", async () => {
    mockFetch(200, { aos: [] });
    const controller = new AbortController();
    controller.abort();
    const result = await searchAos("boot", controller.signal);
    expect(result).toEqual([]);
  });
});

describe("getApiBase (via fetch URL)", () => {
  it("uses NEXT_PUBLIC_API_URL when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://custom.api.test");
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const url = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(url).toContain("https://custom.api.test");
  });

  it("uses localhost:3001 when NEXT_PUBLIC_LOCAL_DEV is true", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_LOCAL_DEV", "true");
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const url = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(url).toContain("localhost:3001");
  });

  it("falls back to api.f3nation.com when the env vars are unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_LOCAL_DEV", undefined);
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const url = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(url).toContain("api.f3nation.com");
  });
});

describe("request headers", () => {
  it("sends the client header and no credential", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORG_MAP_API_KEY", undefined);
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const init = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ client: "https://apps.f3nation.com" });
  });

  it("sends NEXT_PUBLIC_ORG_MAP_API_KEY as a Bearer key when it is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORG_MAP_API_KEY", "test-key");
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const init = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({
      client: "https://apps.f3nation.com",
      Authorization: "Bearer test-key",
    });
  });
});

describe("fetchLeadership", () => {
  it("links orgs past an unknown tier to their nearest known ancestor", async () => {
    mockFetch(200, {
      orgs: [
        { id: 2, name: "Southeast", orgType: "sector", parentId: 1 },
        { id: 50, name: "New Tier", orgType: "galaxy", parentId: 2 },
        { id: 51, name: "Newer Tier", orgType: "galaxy", parentId: 50 },
        { id: 5, name: "Western NC", orgType: "area", parentId: 51 },
        { id: 7, name: "Boone", orgType: "region", parentId: 5 },
        // A cycle of unknown tiers, and a parent missing from the list.
        { id: 60, name: "Loop A", orgType: "galaxy", parentId: 61 },
        { id: 61, name: "Loop B", orgType: "galaxy", parentId: 60 },
        { id: 8, name: "Looped", orgType: "region", parentId: 60 },
        { id: 9, name: "Stray", orgType: "region", parentId: 404 },
      ],
      leaders: [],
    });
    const { orgs } = await fetchLeadership();
    expect(orgs.map((o) => [o.id, o.parentId])).toEqual([
      [2, 1],
      [5, 2],
      [7, 5],
      [8, 60],
      [9, 404],
    ]);
  });

  it("returns the orgs and keeps positions and only the visible roles", async () => {
    const base = {
      orgId: 7,
      id: 1,
      userId: 2,
      f3Name: "Gator",
      avatarUrl: null,
    };
    mockFetch(200, {
      orgs: [
        { id: 7, name: "Boone", orgType: "region", parentId: 5 },
        { id: 9, name: null, orgType: "area", parentId: null },
        { id: 10, name: "Odd", orgType: "galaxy", parentId: null },
      ],
      leaders: [
        { ...base, kind: "position", title: "Nant'an" },
        { ...base, kind: "role", title: "admin" },
        { ...base, kind: "role", title: "password_manager" },
      ],
    });
    const result = await fetchLeadership();
    expect(result.leaders.map((l) => l.title)).toEqual(["Nant'an", "admin"]);
    // Unknown org types are dropped; a missing name gets a placeholder.
    expect(result.orgs).toEqual([
      { id: 7, name: "Boone", orgType: "region", parentId: 5 },
      { id: 9, name: "Org 9", orgType: "area", parentId: null },
    ]);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(
      "/v1/org-chart/leadership",
    );
  });
});
