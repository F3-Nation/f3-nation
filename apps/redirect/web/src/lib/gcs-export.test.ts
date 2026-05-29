import { describe, expect, it } from "vitest";
import { certObjectsForHost } from "./gcs-export";

describe("certObjectsForHost", () => {
  const names = [
    "certs/certificates/acme-v02.api.letsencrypt.org-directory/f3muletown.com/f3muletown.com.crt",
    "certs/certificates/acme-v02.api.letsencrypt.org-directory/f3muletown.com/f3muletown.com.json",
    "certs/certificates/acme-v02.api.letsencrypt.org-directory/www.f3muletown.com/www.f3muletown.com.crt",
    "certs/certificates/acme-v02.api.letsencrypt.org-directory/stats.f3muletown.com/stats.f3muletown.com.crt",
    "certs/acme/acme-v02.api.letsencrypt.org-directory/users/patrick@pstaylor.net/patrick.json",
  ];

  it("matches a host's cert objects by whole path segment", () => {
    const got = certObjectsForHost(names, "f3muletown.com");
    expect(got).toHaveLength(2);
    expect(got.every((n) => n.includes("/f3muletown.com/"))).toBe(true);
  });

  it("does NOT match www.<host> when cleaning the apex (no over-deletion)", () => {
    const got = certObjectsForHost(names, "f3muletown.com");
    expect(got.some((n) => n.includes("www.f3muletown.com"))).toBe(false);
  });

  it("matches a subdomain's own certs", () => {
    expect(certObjectsForHost(names, "stats.f3muletown.com")).toHaveLength(1);
  });

  it("returns nothing for an unknown host", () => {
    expect(certObjectsForHost(names, "nope.example.com")).toHaveLength(0);
  });
});
