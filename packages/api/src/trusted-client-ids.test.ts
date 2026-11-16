import { describe, expect, it } from "vitest";

import { trustedClientIds } from "./trusted-client-ids";

describe("trustedClientIds", () => {
  it.each([undefined, "", " ", " , ,"])("is empty for %j", (raw) => {
    expect([...trustedClientIds(raw)]).toEqual([]);
  });

  it("trims, drops empty entries and dedupes", () => {
    expect([
      ...trustedClientIds(" f3-me-prod , ,f3-admin-prod,f3-me-prod"),
    ]).toEqual(["f3-me-prod", "f3-admin-prod"]);
  });

  it("throws on an entry with inner whitespace", () => {
    expect(() => trustedClientIds("f3-me-prod f3-admin-prod")).toThrow(
      /Invalid AUTH_TRUSTED_CLIENT_IDS entry "f3-me-prod f3-admin-prod"/,
    );
  });
});
