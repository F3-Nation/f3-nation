import { describe, expect, it } from "vitest";

import { verifyRegionBindingS2sToken } from "./region-binding-s2s-auth";

const SECRET = "sssh-this-is-only-a-test-secret";

describe("verifyRegionBindingS2sToken", () => {
  it("accepts a correctly formatted bearer token matching the expected secret", () => {
    const result = verifyRegionBindingS2sToken({
      authorizationHeader: `Bearer ${SECRET}`,
      expectedSecret: SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a missing Authorization header", () => {
    const result = verifyRegionBindingS2sToken({
      authorizationHeader: null,
      expectedSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_header");
  });

  it("rejects a non-bearer header", () => {
    const result = verifyRegionBindingS2sToken({
      authorizationHeader: `Basic ${SECRET}`,
      expectedSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_header");
  });

  it("rejects a bearer header with an empty token", () => {
    const result = verifyRegionBindingS2sToken({
      authorizationHeader: "Bearer  ",
      expectedSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_header");
  });

  it("rejects a bearer token that does not match the expected secret", () => {
    const result = verifyRegionBindingS2sToken({
      authorizationHeader: "Bearer definitely-not-the-secret",
      expectedSecret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_token");
  });

  it("returns server_misconfigured when the expected secret is empty", () => {
    const result = verifyRegionBindingS2sToken({
      authorizationHeader: `Bearer ${SECRET}`,
      expectedSecret: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("server_misconfigured");
  });
});
