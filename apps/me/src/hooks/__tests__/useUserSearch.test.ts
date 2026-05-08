import { describe, it, expect } from "vitest";
import { displayName, matchesSearch } from "../useUserSearch";
import type { UserListItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    id: 1,
    f3Name: "Dredd",
    homeRegionId: 10,
    homeRegionName: "Muletown",
    status: "active",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("displayName", () => {
  it("shows f3Name and region", () => {
    const user = makeUser();
    expect(displayName(user)).toBe("Dredd \u2014 Muletown");
  });

  it("shows only f3Name when no region", () => {
    const user = makeUser({
      homeRegionName: null,
    });
    expect(displayName(user)).toBe("Dredd");
  });

  it("shows only region when no f3Name", () => {
    const user = makeUser({
      f3Name: null,
    });
    expect(displayName(user)).toBe("\u2014 Muletown");
  });

  it("shows only region when only region exists", () => {
    const user = makeUser({
      f3Name: null,
    });
    expect(displayName(user)).toBe("\u2014 Muletown");
  });

  it("falls back to User #id when everything is null", () => {
    const user = makeUser({
      id: 42,
      f3Name: null,
      homeRegionName: null,
    });
    expect(displayName(user)).toBe("User #42");
  });
});

// ---------------------------------------------------------------------------
// matchesSearch
// ---------------------------------------------------------------------------

describe("matchesSearch", () => {
  it("matches by f3Name (case-insensitive)", () => {
    const user = makeUser();
    expect(matchesSearch(user, "dredd")).toBe(true);
    expect(matchesSearch(user, "DREDD")).toBe(true);
  });

  it("matches by region name", () => {
    expect(matchesSearch(makeUser(), "mule")).toBe(true);
  });

  it("returns false for non-matching term", () => {
    expect(matchesSearch(makeUser(), "zzz")).toBe(false);
  });

  it("returns false when all name fields are null", () => {
    const user = makeUser({
      f3Name: null,
      homeRegionName: null,
    });
    expect(matchesSearch(user, "anything")).toBe(false);
  });

  it("matches partial strings", () => {
    expect(matchesSearch(makeUser(), "re")).toBe(true); // "Dredd"
  });

  it("handles empty search term", () => {
    // Empty string is a substring of everything
    expect(matchesSearch(makeUser(), "")).toBe(true);
  });
});
