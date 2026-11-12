import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

const mockEnv = vi.hoisted(() => ({
  SITE_URL: undefined as string | undefined,
  REGIONS2_REDIRECT_STATUS: "307",
}));
vi.mock("@/env", () => ({ env: mockEnv }));

afterEach(() => {
  mockEnv.SITE_URL = undefined;
  mockEnv.REGIONS2_REDIRECT_STATUS = "307";
});

const request = (host: string, forwarded?: string) =>
  new NextRequest(`https://${host}/boise?letter=b`, {
    headers: forwarded ? { host, "x-forwarded-host": forwarded } : { host },
  });

describe("proxy", () => {
  it("307s regions2 to regions once SITE_URL is regions", () => {
    mockEnv.SITE_URL = "https://regions.f3nation.com";
    const res = proxy(request("regions2.f3nation.com"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://regions.f3nation.com/boise?letter=b",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("stays inert while SITE_URL is unset", () => {
    const res = proxy(request("regions2.f3nation.com"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("uses 301 after signoff and prefers x-forwarded-host", () => {
    mockEnv.SITE_URL = "https://regions.f3nation.com";
    mockEnv.REGIONS2_REDIRECT_STATUS = "301";
    const res = proxy(request("internal.run.app", "regions2.f3nation.com"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      "https://regions.f3nation.com/boise?letter=b",
    );
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("passes through while SITE_URL is regions2", () => {
    mockEnv.SITE_URL = "https://regions2.f3nation.com";
    const res = proxy(request("regions2.f3nation.com"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
