import { describe, expect, it } from "vitest";
import {
  apexOf,
  dnsInstructions,
  isApex,
  normalizeHost,
  registerSchema,
} from "./domains";

describe("normalizeHost", () => {
  it("lowercases, trims, strips trailing dot and port", () => {
    expect(normalizeHost("F3Muletown.com")).toBe("f3muletown.com");
    expect(normalizeHost("  stats.f3muletown.com.")).toBe(
      "stats.f3muletown.com",
    );
    expect(normalizeHost("f3muletown.com:443")).toBe("f3muletown.com");
  });
});

describe("isApex / apexOf", () => {
  it("classifies apex vs subdomain", () => {
    expect(isApex("f3muletown.com")).toBe(true);
    expect(isApex("f3marshall.com")).toBe(true);
    expect(isApex("www.f3muletown.com")).toBe(false);
    expect(isApex("stats.f3muletown.com")).toBe(false);
  });
  it("returns the registrable apex", () => {
    expect(apexOf("stats.f3muletown.com")).toBe("f3muletown.com");
    expect(apexOf("f3muletown.com")).toBe("f3muletown.com");
  });
});

describe("registerSchema", () => {
  it("accepts and normalizes valid input", () => {
    const r = registerSchema.parse({
      hostname: "F3Muletown.com",
      destination: "https://x.com/y",
    });
    expect(r.hostname).toBe("f3muletown.com");
    expect(r.destination).toBe("https://x.com/y");
  });
  it("rejects non-FQDN hostnames", () => {
    expect(
      registerSchema.safeParse({
        hostname: "nodot",
        destination: "https://x.com",
      }).success,
    ).toBe(false);
  });
  it("rejects non-http(s) destinations", () => {
    expect(
      registerSchema.safeParse({ hostname: "ok.com", destination: "ftp://x" })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ hostname: "ok.com", destination: "not a url" })
        .success,
    ).toBe(false);
  });
});

describe("dnsInstructions", () => {
  it("apex → required A record FIRST, plus an optional www CNAME suggestion", () => {
    const recs = dnsInstructions("f3muletown.com");
    // The A record for the apex is the primary, required record and comes first.
    expect(recs[0]).toMatchObject({
      type: "A",
      name: "f3muletown.com",
      value: "34.172.36.60",
      optional: false,
    });
    // A secondary, optional suggestion to also redirect the www subdomain.
    const www = recs.find((r) => r.name === "www.f3muletown.com");
    expect(www).toMatchObject({
      type: "CNAME",
      name: "www.f3muletown.com",
      optional: true,
    });
  });
  it("subdomain → CNAME to the canonical host when configured (no apex A needed)", () => {
    const recs = dnsInstructions("www.f3muletown.com", {
      canonicalHost: "redirect.f3regions.com",
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      type: "CNAME",
      name: "www.f3muletown.com",
      value: "redirect.f3regions.com",
    });
  });

  it("subdomain → CNAME to its apex as a fallback when no canonical host is set", () => {
    const recs = dnsInstructions("stats.f3muletown.com", { canonicalHost: "" });
    expect(recs[0]).toMatchObject({
      type: "CNAME",
      name: "stats.f3muletown.com",
      value: "f3muletown.com",
    });
  });

  it("apex still uses an A record regardless of canonical host", () => {
    const recs = dnsInstructions("f3muletown.com", {
      canonicalHost: "redirect.f3regions.com",
    });
    expect(recs[0]).toMatchObject({ type: "A", value: "34.172.36.60" });
  });
});
