import { describe, it, expect } from "vitest";
import { displayName } from "../useUserSearch";
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

  it("falls back to User #id when everything is null", () => {
    const user = makeUser({
      id: 42,
      f3Name: null,
      homeRegionName: null,
    });
    expect(displayName(user)).toBe("User #42");
  });
});
