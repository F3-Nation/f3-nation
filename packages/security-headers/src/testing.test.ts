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
    expect(
      await nextSecurityHeaderProblems(deny, { embeddable: false }),
    ).toEqual([]);
    expect(
      await nextSecurityHeaderProblems(embeddable, { embeddable: true }),
    ).toEqual([]);
  });

  it("reports a config that sets no headers", async () => {
    const problems = await nextSecurityHeaderProblems(
      {},
      { embeddable: false },
    );
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
      await nextSecurityHeaderProblems(deny, { embeddable: true }),
    ).toEqual([
      expect.stringMatching(/^X-Frame-Options/),
      expect.stringMatching(/^Content-Security-Policy/),
      expect.stringMatching(/^Permissions-Policy/),
    ]);
  });

  it("reports an embeddable config checked as deny", async () => {
    expect(
      await nextSecurityHeaderProblems(embeddable, { embeddable: false }),
    ).toEqual([
      expect.stringMatching(/^X-Frame-Options/),
      expect.stringMatching(/^Content-Security-Policy/),
      expect.stringMatching(/^Permissions-Policy/),
    ]);
  });
});
