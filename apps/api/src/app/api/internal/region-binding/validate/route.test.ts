/**
 * Route-handler tests for the internal region-binding validator.
 *
 * We mock `@acme/db/client` (to avoid booting a real connection pool), the
 * validator service (to avoid needing a database at all), the rate limiter
 * (to exercise 429 paths deterministically), and the s2s auth shim.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-s2s-secret";

// --- Module mocks must be hoisted so they apply to `route.ts`'s imports. ---

vi.mock("@acme/db/client", () => ({
  db: {} as unknown,
}));

const mockRunValidator = vi.hoisted(() => vi.fn());
vi.mock("../../../../../lib/region-binding-validator-service", () => ({
  runRegionBindingValidator: mockRunValidator,
}));

const mockRateLimiterCheck = vi.hoisted(() => vi.fn());
vi.mock("../../../../../lib/region-binding-rate-limiter", () => ({
  regionBindingRateLimiter: { check: mockRateLimiterCheck },
  createRegionBindingRateLimiter: vi.fn(),
}));

// Import AFTER mocks have been registered.
import { GET } from "./route";

const authHeader = (token: string = SECRET) => `Bearer ${token}`;

const fullUrl =
  "http://localhost/api/internal/region-binding/validate" +
  "?org_id=123&pax_vault_region_id=35838&region_slug=muletown&calling_user_id=7";

const makeRequest = (
  url: string = fullUrl,
  headers: Record<string, string> = {},
): Request =>
  new Request(url, { headers: { authorization: authHeader(), ...headers } });

const okBody = () => ({
  org: {
    id: 123,
    name: "F3 Muletown",
    last_modified: "2025-12-01T00:00:00.000Z",
    admin_count: 4,
    caller_roles: ["admin"],
  },
  pax_vault: {
    region_id: "35838",
    region_name: "F3 Muletown",
    pax_count: 142,
    most_recent_beatdown: "2026-04-13",
    thumbnail_url:
      "https://pax-vault.f3nation.com/api/regions/35838/thumbnail.png",
  },
  f3_region_pages: {
    slug: "muletown",
    point_of_contact: "Slider",
    page_url: "https://regions.f3nation.com/muletown",
  },
  cross_check: { triple_matches: true, match_strategy: "exact" as const },
  validated_at: "2026-04-14T18:23:00.000Z",
});

describe("GET /api/internal/region-binding/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REGION_BINDING_VALIDATOR_S2S_SECRET = SECRET;
    mockRateLimiterCheck.mockReturnValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("returns 200 with the validator body on the happy path", async () => {
    mockRunValidator.mockResolvedValue({ kind: "ok", body: okBody() });

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReturnType<typeof okBody>;
    expect(body.cross_check.triple_matches).toBe(true);
    expect(body.org.name).toBe("F3 Muletown");
  });

  it("returns 401 invalid_s2s_token when the Authorization header is missing", async () => {
    const response = await GET(new Request(fullUrl));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_s2s_token" });
    expect(mockRunValidator).not.toHaveBeenCalled();
  });

  it("returns 401 invalid_s2s_token when the token is wrong", async () => {
    const response = await GET(
      new Request(fullUrl, {
        headers: { authorization: "Bearer wrong-token" },
      }),
    );
    expect(response.status).toBe(401);
    expect(mockRunValidator).not.toHaveBeenCalled();
  });

  it("returns 400 when query params are missing", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/internal/region-binding/validate?org_id=1",
        { headers: { authorization: authHeader() } },
      ),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_query");
  });

  it("returns 400 when org_id is not a positive integer", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/internal/region-binding/validate" +
          "?org_id=abc&pax_vault_region_id=35838&region_slug=muletown&calling_user_id=7",
        { headers: { authorization: authHeader() } },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns 429 with Retry-After when the rate limiter denies", async () => {
    mockRateLimiterCheck.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 42,
    });

    const response = await GET(makeRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(mockRunValidator).not.toHaveBeenCalled();
  });

  it("returns 403 when the validator reports forbidden", async () => {
    mockRunValidator.mockResolvedValue({
      kind: "forbidden",
      reason: "caller_not_authorized_on_org",
    });

    const response = await GET(makeRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "caller_not_authorized_on_org",
    });
  });

  it("returns 422 with detail when the validator reports mismatch", async () => {
    mockRunValidator.mockResolvedValue({
      kind: "mismatch",
      detail: {
        mismatches: [
          {
            field: "region_slug",
            sources: { query_param: "a", f3_region_pages_response: "b" },
            reason: "no",
          },
        ],
      },
    });

    const response = await GET(makeRequest());
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; detail: unknown };
    expect(body.error).toBe("triple_mismatch");
    expect(body.detail).toBeDefined();
  });

  it("returns 503 with source when pax_vault is unavailable", async () => {
    mockRunValidator.mockResolvedValue({
      kind: "source_unavailable",
      source: "pax_vault",
      message: "down",
    });

    const response = await GET(makeRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "source_unavailable",
      source: "pax_vault",
    });
  });

  it("returns 503 with source when f3_region_pages is unavailable", async () => {
    mockRunValidator.mockResolvedValue({
      kind: "source_unavailable",
      source: "f3_region_pages",
      message: "down",
    });

    const response = await GET(makeRequest());
    expect(response.status).toBe(503);
    expect((await response.json()) as { source: string }).toEqual({
      error: "source_unavailable",
      source: "f3_region_pages",
    });
  });

  it("returns 404 when the org does not exist", async () => {
    mockRunValidator.mockResolvedValue({ kind: "org_not_found" });

    const response = await GET(makeRequest());
    expect(response.status).toBe(404);
  });
});
