import { describe, expect, it } from "vitest";

import { canonicalRedirect } from "@/lib/redirect";

const PROD = "https://regions.f3nation.com";
const ALIAS = "https://regions2.f3nation.com";
const url = (path: string) => new URL(path, ALIAS);

describe("canonicalRedirect", () => {
  it("stays inert while SITE_URL is the regions2 alias", () => {
    expect(
      canonicalRedirect("regions2.f3nation.com", url("/boise"), ALIAS),
    ).toBeNull();
  });

  it("stays inert on staging", () => {
    expect(
      canonicalRedirect(
        "regions2.f3nation.com",
        url("/boise"),
        "https://staging.regions.f3nation.com",
      ),
    ).toBeNull();
  });

  it("redirects regions2 to regions keeping path and query", () => {
    expect(
      canonicalRedirect("regions2.f3nation.com", url("/?letter=a"), PROD),
    ).toBe("https://regions.f3nation.com/?letter=a");
    expect(
      canonicalRedirect("regions2.f3nation.com", url("/boise/events/x"), PROD),
    ).toBe("https://regions.f3nation.com/boise/events/x");
  });

  it("does not redirect the canonical host", () => {
    expect(
      canonicalRedirect("regions.f3nation.com", url("/boise"), PROD),
    ).toBeNull();
  });

  it("normalizes case, port, and forwarded lists", () => {
    expect(
      canonicalRedirect("REGIONS2.f3nation.com:443, proxy", url("/a"), PROD),
    ).toBe("https://regions.f3nation.com/a");
  });

  it("passes /health and /favicon.ico through exactly", () => {
    expect(
      canonicalRedirect("regions2.f3nation.com", url("/health"), PROD),
    ).toBeNull();
    expect(
      canonicalRedirect("regions2.f3nation.com", url("/favicon.ico"), PROD),
    ).toBeNull();
    expect(
      canonicalRedirect("regions2.f3nation.com", url("/health-club"), PROD),
    ).toBe("https://regions.f3nation.com/health-club");
  });

  it("ignores a missing host", () => {
    expect(canonicalRedirect(null, url("/a"), PROD)).toBeNull();
  });
});
