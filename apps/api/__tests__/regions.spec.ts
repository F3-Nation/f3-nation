import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const buildRequest = (path: string, headers?: HeadersInit) =>
  new NextRequest(new URL(path, "http://localhost").toString(), { headers });

const loadHandler = async () => {
  vi.resetModules();
  return import("../app/api/v1/regions/route");
};

describe("GET /api/v1/regions", () => {
  const validHeaders = { "x-api-key": process.env.API_KEY! };

  it("returns 401 when no API key is provided", async () => {
    const { GET } = await loadHandler();
    const response = await GET(buildRequest("/api/v1/regions"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toMatch(/api key/i);
  });

  it("returns 403 when the API key is invalid", async () => {
    const { GET } = await loadHandler();
    const response = await GET(
      buildRequest("/api/v1/regions", { "x-api-key": "wrong-key" }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects page sizes that exceed the configured limit", async () => {
    const { GET } = await loadHandler();
    const response = await GET(
      buildRequest("/api/v1/regions?pageSize=1000", {
        "x-api-key": process.env.API_KEY!,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/pageSize/i);
  });

  it("returns paginated data with metadata", async () => {
    const { GET } = await loadHandler();
    const response = await GET(
      buildRequest("/api/v1/regions?page=2&pageSize=2", {
        "x-api-key": process.env.API_KEY!,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toHaveLength(2);
    expect(payload.metadata).toMatchObject({
      page: 2,
      pageSize: 2,
      total: expect.any(Number),
      totalPages: expect.any(Number),
      next: expect.any(Number),
      prev: expect.any(Number),
    });
  });

  it("falls back to defaults when pagination is omitted or invalid", async () => {
    const { GET } = await loadHandler();
    const response = await GET(buildRequest("/api/v1/regions", validHeaders));
    const payload = await response.json();

    expect(payload.metadata).toMatchObject({
      page: 1,
      pageSize: 100,
      total: expect.any(Number),
      totalPages: 1,
      next: null,
      prev: null,
    });
    expect(payload.data).toHaveLength(5);
  });

  it("accepts Bearer auth, floors pageSize, and clamps page to the last page", async () => {
    const { GET } = await loadHandler();
    const response = await GET(
      buildRequest("/api/v1/regions?page=99&pageSize=2.7", {
        authorization: `Bearer ${process.env.API_KEY!}`,
      }),
    );
    const payload = await response.json();

    expect(payload.metadata).toMatchObject({
      page: 3,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      next: null,
      prev: 2,
    });
    expect(payload.data).toHaveLength(1);
  });
});
