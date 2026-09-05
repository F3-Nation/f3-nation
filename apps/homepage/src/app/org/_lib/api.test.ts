import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchOrgChart, fetchOrgById } from "./api";

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

  it("falls back to api.f3nation.com with no env vars", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_LOCAL_DEV", "");
    mockFetch(200, { orgs: [] });
    await fetchOrgChart();
    const url = (fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(url).toContain("api.f3nation.com");
  });
});
