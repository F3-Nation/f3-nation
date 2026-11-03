import { describe, expect, it } from "vitest";

import {
  HSTS_VALUE,
  nextSecurityHeaders,
  securityHeaders,
  securityHeadersRecord,
} from "./index.js";

const toRecord = (headers: { key: string; value: string }[]) =>
  Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("always sends HSTS (no preload, no includeSubDomains), nosniff and referrer policy", () => {
    for (const frame of ["deny", "embeddable"] as const) {
      const h = toRecord(securityHeaders({ frame }));
      expect(h["Strict-Transport-Security"]).toBe(HSTS_VALUE);
      expect(HSTS_VALUE).not.toMatch(/preload|includeSubDomains/i);
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    }
  });

  it("denies framing two ways when frame is deny", () => {
    const h = toRecord(securityHeaders({ frame: "deny" }));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });

  it("sends no framing header when embeddable", () => {
    const h = toRecord(securityHeaders({ frame: "embeddable" }));
    expect(h).not.toHaveProperty("X-Frame-Options");
    expect(h).not.toHaveProperty("Content-Security-Policy");
  });

  it("never ships an enforced CSP beyond frame-ancestors", () => {
    for (const frame of ["deny", "embeddable"] as const) {
      const csp = toRecord(securityHeaders({ frame }))[
        "Content-Security-Policy"
      ];
      if (csp !== undefined) expect(csp).toBe("frame-ancestors 'none'");
    }
  });

  it("turns geolocation off unless asked, and only ever for self", () => {
    const off = toRecord(securityHeaders({ frame: "deny" }));
    expect(off["Permissions-Policy"]).toContain("geolocation=()");
    const on = toRecord(
      securityHeaders({ frame: "embeddable", geolocation: true }),
    );
    expect(on["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(on["Permissions-Policy"]).toContain("camera=()");
    expect(on["Permissions-Policy"]).toContain("microphone=()");
  });
});

describe("nextSecurityHeaders", () => {
  it("applies to every path", async () => {
    const rules = await nextSecurityHeaders({ frame: "deny" })();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
    expect(rules[0]?.headers).toEqual(securityHeaders({ frame: "deny" }));
  });
});

describe("securityHeadersRecord", () => {
  it("matches securityHeaders as a plain record", () => {
    expect(securityHeadersRecord({ frame: "deny" })).toEqual(
      toRecord(securityHeaders({ frame: "deny" })),
    );
  });
});
