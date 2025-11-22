import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RegionsResponse } from "./page";
import Home, {
  fetchRegions,
  formatLocation,
  PAGE_SIZE,
  parsePositiveInt,
} from "./page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  Object.assign(process.env, originalEnv);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(process.env, originalEnv);
});

describe("parsePositiveInt", () => {
  it("parses valid numbers and falls back otherwise", () => {
    expect(parsePositiveInt("4", 1)).toBe(4);
    expect(parsePositiveInt("2.9", 1)).toBe(2);
    expect(parsePositiveInt("-3", 5)).toBe(5);
    expect(parsePositiveInt("not-a-number", 7)).toBe(7);
    expect(parsePositiveInt(["8", "9"], 1)).toBe(8);
  });
});

describe("formatLocation", () => {
  it("joins available location parts", () => {
    expect(
      formatLocation({
        id: "1",
        name: "Test Region",
        slug: "test",
        city: "Austin",
        state: "TX",
        country: "USA",
        website: null,
      }),
    ).toBe("Austin, TX, USA");
  });

  it("returns placeholder when no parts are present", () => {
    expect(
      formatLocation({
        id: "2",
        name: "Missing Location",
        slug: "missing",
        city: null,
        state: null,
        country: null,
        website: null,
      }),
    ).toBe("Location coming soon");
  });
});

describe("fetchRegions", () => {
  it("throws when required environment variables are missing", async () => {
    await expect(fetchRegions(1)).rejects.toThrow(
      "Missing API_BASE_URL or API_KEY in environment.",
    );
  });

  it("requests the regions endpoint with pagination params", async () => {
    const mockResponse: RegionsResponse = {
      data: [],
      metadata: {
        page: 2,
        pageSize: PAGE_SIZE,
        total: 0,
        totalPages: 0,
        next: null,
        prev: 1,
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.API_BASE_URL = "https://api.example.com";
    process.env.API_KEY = "secret";

    const result = await fetchRegions(2);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/regions?page=2&pageSize=10",
      {
        headers: { "x-api-key": "secret" },
        cache: "no-store",
      },
    );
    expect(result).toEqual(mockResponse);
  });

  it("throws when the API returns a non-OK response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.API_BASE_URL = "https://api.example.com";
    process.env.API_KEY = "secret";

    await expect(fetchRegions(1)).rejects.toThrow(
      "Failed to fetch regions (status 500).",
    );
  });
});

describe("Home component", () => {
  it("renders the regions and pagination links on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: "1",
            name: "F3 Metro",
            slug: "f3-metro",
            city: "Charlotte",
            state: "NC",
            country: "USA",
            website: "https://f3nation.com",
            description: "Early morning workouts.",
          },
        ],
        metadata: {
          page: 1,
          pageSize: PAGE_SIZE,
          total: 10,
          totalPages: 2,
          next: 2,
          prev: null,
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.API_BASE_URL = "https://api.example.com";
    process.env.API_KEY = "secret";

    const html = renderToStaticMarkup(
      await Home({ searchParams: { page: "1" } }),
    );
    const dom = new DOMParser().parseFromString(html, "text/html");

    expect(dom.querySelector("h1")?.textContent).toContain("F3 Regions");
    expect(dom.querySelector("article h2")?.textContent).toBe("F3 Metro");
    expect(
      dom.querySelector('a[href="https://f3nation.com"]')?.textContent,
    ).toBe("Visit site");
    expect(dom.querySelector('a[href="/?page=2"]')).toBeTruthy();
    expect(dom.querySelector("span")?.textContent).toBe("Previous");
  });

  it("renders an error message when fetching fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    process.env.API_BASE_URL = "https://api.example.com";
    process.env.API_KEY = "secret";

    const html = renderToStaticMarkup(
      await Home({ searchParams: { page: "1" } }),
    );
    const dom = new DOMParser().parseFromString(html, "text/html");

    expect(dom.querySelector("h1")?.textContent).toContain(
      "Unable to load regions",
    );
    expect(dom.querySelector("p")?.textContent).toContain("network down");
  });
});
