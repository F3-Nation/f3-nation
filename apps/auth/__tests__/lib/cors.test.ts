import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = { select: vi.fn(() => chain([])) };

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/oauth", () => ({ getClient: vi.fn() }));

const { getClient } = await import("~/lib/oauth");
const { getCorsHeaders, handlePreflight } = await import("~/lib/cors");

const ORIGIN = "https://app.example.test";

const ALLOWED_HEADERS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

function makeRequest(origin?: string): NextRequest {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return { headers } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(getClient).mockReset();
  dbMock.select.mockReset();
  dbMock.select.mockImplementation(() => chain([]));
});

describe("getCorsHeaders", () => {
  it("returns no headers without an Origin", async () => {
    await expect(getCorsHeaders(makeRequest(), "client-1")).resolves.toEqual(
      {},
    );
    expect(getClient).not.toHaveBeenCalled();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("allows the origin registered for the given client", async () => {
    vi.mocked(getClient).mockResolvedValue({
      allowedOrigin: ORIGIN,
    } as Awaited<ReturnType<typeof getClient>>);
    await expect(
      getCorsHeaders(makeRequest(ORIGIN), "client-1"),
    ).resolves.toEqual(ALLOWED_HEADERS);
    expect(getClient).toHaveBeenCalledWith("client-1");
  });

  it("refuses an origin the given client is not registered for", async () => {
    vi.mocked(getClient).mockResolvedValue({
      allowedOrigin: "https://other.example.test",
    } as Awaited<ReturnType<typeof getClient>>);
    await expect(
      getCorsHeaders(makeRequest(ORIGIN), "client-1"),
    ).resolves.toEqual({});
  });

  it("refuses when the given client does not exist", async () => {
    vi.mocked(getClient).mockResolvedValue(null);
    await expect(
      getCorsHeaders(makeRequest(ORIGIN), "missing"),
    ).resolves.toEqual({});
  });

  it("allows a preflight origin that some client is registered for", async () => {
    dbMock.select.mockImplementation(() => chain([{ id: "client-1" }]));
    await expect(getCorsHeaders(makeRequest(ORIGIN))).resolves.toEqual(
      ALLOWED_HEADERS,
    );
    expect(getClient).not.toHaveBeenCalled();
  });

  it("refuses a preflight origin no client is registered for", async () => {
    await expect(getCorsHeaders(makeRequest(ORIGIN))).resolves.toEqual({});
  });
});

describe("handlePreflight", () => {
  it("answers 204 with the given headers", () => {
    const response = handlePreflight(ALLOWED_HEADERS);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
});
