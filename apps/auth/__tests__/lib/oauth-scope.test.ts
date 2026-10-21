import { describe, expect, it } from "vitest";

import {
  idTokenScopeOrNull,
  withoutOfflineAccess,
} from "../../src/lib/oauth-scope";

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

describe("withoutOfflineAccess", () => {
  const LEGACY = "openid profile email";

  it("drops offline_access and keeps the other scopes in order", () => {
    expect(
      withoutOfflineAccess("openid profile email offline_access", LEGACY),
    ).toBe("openid profile email");
    expect(withoutOfflineAccess("offline_access openid", LEGACY)).toBe(
      "openid",
    );
  });

  it("returns a scope string without offline_access unchanged", () => {
    expect(withoutOfflineAccess("openid profile email", LEGACY)).toBe(
      "openid profile email",
    );
    expect(withoutOfflineAccess("openid  profile", LEGACY)).toBe(
      "openid  profile",
    );
  });

  it("removes only the offline_access token, keeping irregular spacing", () => {
    // validateScopes rejects the empty entries either way, so the outcome
    // for a malformed request doesn't change.
    expect(withoutOfflineAccess("openid  profile offline_access", LEGACY)).toBe(
      "openid  profile",
    );
  });

  it("leaves nothing to grant for offline_access alone", () => {
    expect(withoutOfflineAccess("offline_access", LEGACY)).toBe("");
  });

  it("keeps offline_access for a client that registered it", () => {
    expect(
      withoutOfflineAccess(
        "openid profile email offline_access",
        "openid profile email offline_access",
      ),
    ).toBe("openid profile email offline_access");
  });

  it("uses the same default registration as validateScopes", () => {
    expect(withoutOfflineAccess("openid offline_access", null)).toBe("openid");
  });
});
