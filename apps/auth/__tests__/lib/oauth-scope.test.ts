import { describe, expect, it } from "vitest";

import { idTokenScopeOrNull } from "../../src/lib/oauth-scope";

// This is the security-critical gate deciding whether either grant handler
// in oauth.ts issues an ID Token at all. Extracted as a pure predicate so
// it has direct coverage — every other test in this suite grants "openid"
// as part of its scope string, so none of them would fail if a refactor
// silently reverted this gate back to "always issue."
describe("idTokenScopeOrNull", () => {
  it("returns the scope string unchanged when openid was granted", () => {
    expect(idTokenScopeOrNull("openid profile email")).toBe(
      "openid profile email",
    );
  });

  it("returns the scope string unchanged for a bare openid grant", () => {
    expect(idTokenScopeOrNull("openid")).toBe("openid");
  });

  it("returns null when openid was not granted", () => {
    expect(idTokenScopeOrNull("profile email")).toBeNull();
  });

  it("returns null for a null grant (the fail-closed anomaly case)", () => {
    expect(idTokenScopeOrNull(null)).toBeNull();
  });

  it("returns null for an undefined grant", () => {
    expect(idTokenScopeOrNull(undefined)).toBeNull();
  });

  it("returns null for an empty scope string", () => {
    expect(idTokenScopeOrNull("")).toBeNull();
  });
});
