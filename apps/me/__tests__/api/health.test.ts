import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  healthResponseSchema,
  HEALTH_CONTRACT_VERSION,
} from "@f3nation/health";

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
}));

describe("Health API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.F3_API_BASE_URL = "https://api.test.f3nation.com/v1";
  });

  it("returns HTTP 200 with cache-control no-store and contract-valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/health/route");
    const response = await GET();
    const data = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const parsed = healthResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.service).toBe("f3-me");
      expect(parsed.data.contractVersion).toBe(HEALTH_CONTRACT_VERSION);
      expect(parsed.data.checks).toHaveLength(1);
      expect(parsed.data.checks[0]?.id).toBe("f3-api-upstream");
      expect(parsed.data.status).toBe("ok");
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/ping",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
  });

  it("returns degraded/down body status based on upstream HTTP failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    const { GET } = await import("@/app/health/route");
    const response = await GET();
    const data = (await response.json()) as {
      status: string;
      checks: { status: string; severity: string; details?: unknown }[];
    };

    expect(response.status).toBe(200);
    expect(data.status).toBe("down");
    expect(data.checks[0]?.status).toBe("down");
    expect(data.checks[0]?.severity).toBe("critical");
  });

  it("returns degraded body status for non-5xx upstream failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const { GET } = await import("@/app/health/route");
    const response = await GET();
    const data = (await response.json()) as {
      status: string;
      checks: { status: string; severity: string }[];
    };

    expect(response.status).toBe(200);
    // A 404 is a client-side error, not a server outage — status should be degraded.
    expect(data.checks[0]?.status).toBe("degraded");
    // Even with critical severity, a degraded check must not roll up to "down".
    expect(data.checks[0]?.severity).toBe("critical");
    expect(data.status).toBe("degraded");
  });

  it("returns contract-valid down response when upstream is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const { GET } = await import("@/app/health/route");
    const response = await GET();
    const data = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    const parsed = healthResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("down");
      expect(parsed.data.checks[0]?.details).toMatchObject({
        reason: "unreachable",
      });
    }
  });

  it("returns contract-valid down response when F3_API_BASE_URL is malformed", async () => {
    process.env.F3_API_BASE_URL = "not a valid url";
    vi.stubGlobal("fetch", vi.fn());

    const { GET } = await import("@/app/health/route");
    const response = await GET();
    const data = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    const parsed = healthResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("down");
      expect(parsed.data.checks[0]?.details).toMatchObject({
        reason: "invalid_config",
      });
    }
  });

  it("returns contract-valid down response when F3_API_BASE_URL is missing", async () => {
    delete process.env.F3_API_BASE_URL;
    vi.stubGlobal("fetch", vi.fn());

    const { GET } = await import("@/app/health/route");
    const response = await GET();
    const data = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    const parsed = healthResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("down");
      expect(parsed.data.checks[0]?.details).toMatchObject({
        reason: "missing_config",
      });
    }
  });
});
