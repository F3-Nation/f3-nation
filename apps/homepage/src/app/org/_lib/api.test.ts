import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchOrgChart,
  fetchOrgById,
  fetchLocationById,
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

describe("auth headers", () => {
  it("sends the client header and a bearer token when the API key is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORG_MAP_API_KEY", "test-key");
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const init = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.client).toBe("https://apps.f3nation.com");
    expect(headers.Authorization).toBe("Bearer test-key");
  });

  it("omits the Authorization header when no API key is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORG_MAP_API_KEY", undefined);
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const init = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.client).toBe("https://apps.f3nation.com");
  });
});
