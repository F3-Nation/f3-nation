import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const envMock = { SUPER_ADMIN_API_KEY: "test-secret" as string | undefined };
vi.mock("~/env", () => ({ env: envMock }));

const { requireSuperAdminApiKey } = await import("~/lib/require-super-admin");

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe("requireSuperAdminApiKey", () => {
  it("allows a request whose x-api-key matches SUPER_ADMIN_API_KEY", () => {
    const result = requireSuperAdminApiKey(
      makeRequest({ "x-api-key": "test-secret" }),
    );
    expect(result).toBeNull();
  });

  it("rejects a request with a mismatched x-api-key", async () => {
    const result = requireSuperAdminApiKey(
      makeRequest({ "x-api-key": "wrong" }),
    );
    expect(result?.status).toBe(401);
    expect(await result?.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a request with no x-api-key header at all", () => {
    const result = requireSuperAdminApiKey(makeRequest());
    expect(result?.status).toBe(401);
  });

  it("rejects even a header/config match of empty strings when SUPER_ADMIN_API_KEY is unconfigured", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: { SUPER_ADMIN_API_KEY: undefined },
    }));
    const { requireSuperAdminApiKey: requireWithNoKeyConfigured } =
      await import("~/lib/require-super-admin");

    const result = requireWithNoKeyConfigured(makeRequest({ "x-api-key": "" }));
    expect(result?.status).toBe(401);
  });
});
