import { describe, expect, it } from "vitest";

import { nextSecurityHeaders } from "./index.js";
import { nextSecurityHeaderProblems } from "./testing.js";

const deny = {
  poweredByHeader: false,
  headers: nextSecurityHeaders({ frame: "deny" }),
};
const embeddable = {
  poweredByHeader: false,
  headers: nextSecurityHeaders({ frame: "embeddable", geolocation: true }),
};

describe("nextSecurityHeaderProblems", () => {
  it("accepts the helper's own output for each framing mode", async () => {
    expect(await nextSecurityHeaderProblems(deny, { frame: "deny" })).toEqual(
      [],
    );
    expect(
      await nextSecurityHeaderProblems(embeddable, {
        frame: "embeddable",
        geolocation: true,
      }),
    ).toEqual([]);
  });

  it("accepts a stricter policy that still meets the baseline", async () => {
    const strict = {
      poweredByHeader: false,
      headers: () =>
        Promise.resolve([
          {
            source: "/:path*",
            headers: [
              {
                key: "Content-Security-Policy",
                value: "default-src 'self'; frame-ancestors 'none'",
              },
              {
                key: "Permissions-Policy",
                value: "camera=(), geolocation=(self)",
              },
              { key: "X-Content-Type-Options", value: "nosniff" },
              {
                key: "Referrer-Policy",
                value: "strict-origin-when-cross-origin",
              },
              { key: "X-Frame-Options", value: "DENY" },
              {
                key: "Strict-Transport-Security",
                value: "max-age=63072000; includeSubDomains",
              },
            ],
          },
        ]),
    };
    expect(
      await nextSecurityHeaderProblems(strict, {
        frame: "deny",
        geolocation: true,
      }),
    ).toEqual([]);
  });

  it("reports a config that sets no headers", async () => {
    const problems = await nextSecurityHeaderProblems({}, { frame: "deny" });
    expect(problems).toEqual(
      expect.arrayContaining([
        "poweredByHeader must be false",
        "headers() must return exactly one rule for /:path*",
        expect.stringMatching(/^Strict-Transport-Security/),
        expect.stringMatching(/^X-Frame-Options/),
      ]),
    );
  });

  it("reports a deny config checked as embeddable", async () => {
    expect(
      await nextSecurityHeaderProblems(deny, {
        frame: "embeddable",
        geolocation: true,
      }),
    ).toEqual([
      expect.stringMatching(/^Permissions-Policy/),
      expect.stringMatching(/^X-Frame-Options/),
      expect.stringMatching(/^Content-Security-Policy/),
    ]);
  });

  it("reports an embeddable config checked as deny", async () => {
    expect(
      await nextSecurityHeaderProblems(embeddable, { frame: "deny" }),
    ).toEqual([
      expect.stringMatching(/^Permissions-Policy/),
      expect.stringMatching(/^X-Frame-Options/),
      expect.stringMatching(/^Content-Security-Policy/),
    ]);
  });
});
