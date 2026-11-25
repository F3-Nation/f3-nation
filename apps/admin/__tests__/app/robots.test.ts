import { describe, expect, it } from "vitest";

import robots from "../../src/app/robots";

describe("robots", () => {
  it("disallows every path for every crawler and lists no sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});
