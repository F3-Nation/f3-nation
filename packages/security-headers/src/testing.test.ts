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

/** Returns `config` with `extra` merged into its one rule. */
function withRule(config: typeof deny, extra: Record<string, unknown>) {
  return {
    ...config,
    headers: async () =>
      (await config.headers()).map((rule) => ({
        ...rule,
        ...extra,
        headers: [
          ...rule.headers,
          ...((extra.headers as typeof rule.headers | undefined) ?? []),
        ],
      })),
  };
}

/** Returns `config` with one header's value replaced. */
function withHeader(config: typeof deny, key: string, value: string) {
  return {
    ...config,
    headers: async () =>
      (await config.headers()).map((rule) => ({
        ...rule,
        headers: rule.headers.map((h) => (h.key === key ? { key, value } : h)),
      })),
  };
}

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
                value:
                  "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
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
        expect.stringMatching(/^X-Content-Type-Options/),
        expect.stringMatching(/^Referrer-Policy/),
        expect.stringContaining("want camera=()"),
      ]),
    );
  });

  it("reports an HSTS max-age below the baseline", async () => {
    const config = withHeader(deny, "Strict-Transport-Security", "max-age=0");
    expect(await nextSecurityHeaderProblems(config, { frame: "deny" })).toEqual(
      [expect.stringMatching(/^Strict-Transport-Security.*max-age>=31536000/)],
    );
  });

  it("reports a missing or lookalike Permissions-Policy directive", async () => {
    const config = withHeader(
      deny,
      "Permissions-Policy",
      "not-camera=(), payment=(), usb=(), geolocation=()",
    );
    expect(await nextSecurityHeaderProblems(config, { frame: "deny" })).toEqual(
      [
        expect.stringContaining("want camera=()"),
        expect.stringContaining("want microphone=()"),
      ],
    );
  });

  it("reports a /:path* rule that only applies under a condition", async () => {
    for (const condition of ["has", "missing"]) {
      const config = withRule(deny, {
        [condition]: [{ type: "header", key: "x-preview" }],
      });
      expect(
        await nextSecurityHeaderProblems(config, { frame: "deny" }),
      ).toEqual(["the /:path* rule must not have has/missing conditions"]);
    }
  });

  it("reads a later header in another case as replacing the first", async () => {
    const config = withRule(deny, {
      headers: [{ key: "strict-transport-security", value: "max-age=0" }],
    });
    expect(await nextSecurityHeaderProblems(config, { frame: "deny" })).toEqual(
      [expect.stringMatching(/^Strict-Transport-Security: got "max-age=0"/)],
    );
  });

  it("accepts header names in any case", async () => {
    const config = {
      ...deny,
      headers: async () =>
        (await deny.headers()).map((rule) => ({
          ...rule,
          headers: rule.headers.map((h) => ({
            ...h,
            key: h.key.toLowerCase(),
          })),
        })),
    };
    expect(await nextSecurityHeaderProblems(config, { frame: "deny" })).toEqual(
      [],
    );
  });

  it("reads only the first frame-ancestors directive", async () => {
    const config = withHeader(
      deny,
      "Content-Security-Policy",
      "frame-ancestors *; frame-ancestors 'none'",
    );
    expect(await nextSecurityHeaderProblems(config, { frame: "deny" })).toEqual(
      [expect.stringMatching(/^Content-Security-Policy/)],
    );
  });

  it("reports a disabled feature re-enabled by a later duplicate", async () => {
    const config = withHeader(
      deny,
      "Permissions-Policy",
      "camera=(), microphone=(), payment=(), usb=(), geolocation=(), microphone=*",
    );
    expect(await nextSecurityHeaderProblems(config, { frame: "deny" })).toEqual(
      [expect.stringContaining("want microphone=()")],
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
