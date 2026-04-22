import { describe, it, expect } from "vitest";
import {
  parseMeta,
  buildInitialFormState,
  buildDirtyPayload,
  dirtyFieldClass,
} from "./useProfileForm";
import type { ProfileFormState } from "./useProfileForm";
import type { UserProfile } from "@/lib/types";

// ---------------------------------------------------------------------------
// parseMeta
// ---------------------------------------------------------------------------

describe("parseMeta", () => {
  it("returns empty object for null", () => {
    expect(parseMeta(null)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseMeta("")).toEqual({});
  });

  it("returns the object directly when meta is already an object", () => {
    const meta = { f3_name_origin: "test", my_f3_why: "fitness" };
    expect(parseMeta(meta)).toEqual(meta);
  });

  it("parses valid JSON string", () => {
    const json = JSON.stringify({ f3_name_origin: "origin story" });
    expect(parseMeta(json)).toEqual({ f3_name_origin: "origin story" });
  });

  it("returns empty object for invalid JSON string", () => {
    expect(parseMeta("not valid json{")).toEqual({});
  });

  it("handles object with unknown extra keys", () => {
    const meta = { f3_name_origin: "test", some_other_field: 42 };
    const result = parseMeta(meta);
    expect(result.f3_name_origin).toBe("test");
    expect(result).toHaveProperty("some_other_field", 42);
  });
});

// ---------------------------------------------------------------------------
// buildInitialFormState
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 1,
    f3Name: "Dredd",
    firstName: "Patrick",
    lastName: "Smith",
    email: "dredd@f3nation.com",
    emailVerified: null,
    phone: "555-1234",
    homeRegionId: 10,
    avatarUrl: "https://example.com/avatar.jpg",
    meta: null,
    emergencyContact: "Jane",
    emergencyPhone: "555-5678",
    emergencyNotes: "No allergies",
    status: "active",
    roles: [],
    positions: [],
    created: "2024-01-01",
    updated: "2024-06-01",
    ...overrides,
  };
}

describe("buildInitialFormState", () => {
  it("maps all UserProfile fields to form state", () => {
    const user = makeUser();
    const state = buildInitialFormState(user);

    expect(state.f3Name).toBe("Dredd");
    expect(state.firstName).toBe("Patrick");
    expect(state.lastName).toBe("Smith");
    expect(state.phone).toBe("555-1234");
    expect(state.homeRegionId).toBe(10);
    expect(state.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(state.emergencyContact).toBe("Jane");
    expect(state.emergencyPhone).toBe("555-5678");
    expect(state.emergencyNotes).toBe("No allergies");
  });

  it("defaults null string fields to empty string", () => {
    const user = makeUser({
      firstName: null,
      phone: null,
      emergencyContact: null,
      emergencyPhone: null,
      emergencyNotes: null,
    });
    const state = buildInitialFormState(user);

    expect(state.firstName).toBe("");
    expect(state.phone).toBe("");
    expect(state.emergencyContact).toBe("");
    expect(state.emergencyPhone).toBe("");
    expect(state.emergencyNotes).toBe("");
  });

  it("extracts meta fields from object meta", () => {
    const user = makeUser({
      meta: {
        f3_name_origin: "My story",
        my_f3_why: "Fitness",
        user_emergency_info_dr_sharing: true,
        start_date_override: "2020-01-01",
        brought_by: 42,
      },
    });
    const state = buildInitialFormState(user);

    expect(state.f3_name_origin).toBe("My story");
    expect(state.my_f3_why).toBe("Fitness");
    expect(state.user_emergency_info_dr_sharing).toBe(true);
    expect(state.start_date_override).toBe("2020-01-01");
    expect(state.brought_by).toBe(42);
  });

  it("extracts meta fields from JSON string meta", () => {
    const user = makeUser({
      meta: JSON.stringify({ f3_name_origin: "parsed" }),
    });
    const state = buildInitialFormState(user);
    expect(state.f3_name_origin).toBe("parsed");
  });

  it("defaults meta fields when meta is null", () => {
    const user = makeUser({ meta: null });
    const state = buildInitialFormState(user);

    expect(state.f3_name_origin).toBe("");
    expect(state.my_f3_why).toBe("");
    expect(state.user_emergency_info_dr_sharing).toBe(false);
    expect(state.start_date_override).toBe("");
    expect(state.brought_by).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// buildDirtyPayload
// ---------------------------------------------------------------------------

describe("buildDirtyPayload", () => {
  const initial: ProfileFormState = {
    f3Name: "Dredd",
    firstName: "Patrick",
    lastName: "Smith",
    phone: "555-1234",
    homeRegionId: 10,
    avatarUrl: "https://example.com/avatar.jpg",
    emergencyContact: "Jane",
    emergencyPhone: "555-5678",
    emergencyNotes: "No allergies",
    f3_name_origin: "",
    my_f3_why: "",
    user_emergency_info_dr_sharing: false,
    start_date_override: "",
    brought_by: null,
  };

  it("returns empty object when nothing changed", () => {
    expect(buildDirtyPayload({ ...initial }, initial)).toEqual({});
  });

  it("includes only changed fields", () => {
    const form = { ...initial, f3Name: "New Name", phone: "999-0000" };
    const payload = buildDirtyPayload(form, initial);

    expect(payload).toEqual({ f3Name: "New Name", phone: "999-0000" });
  });

  it("excludes avatarUrl even when changed", () => {
    const form = { ...initial, avatarUrl: "https://new.com/img.jpg" };
    const payload = buildDirtyPayload(form, initial);

    expect(payload).toEqual({});
  });

  it("coerces empty nullable text fields to null", () => {
    const form = { ...initial, firstName: "", phone: "" };
    const payload = buildDirtyPayload(form, initial);

    expect(payload.firstName).toBeNull();
    expect(payload.phone).toBeNull();
  });

  it("coerces empty non-nullable text fields to empty string", () => {
    const form = { ...initial, f3Name: "" };
    const payload = buildDirtyPayload(form, initial);

    expect(payload.f3Name).toBe("");
  });

  it("includes boolean field changes", () => {
    const form = { ...initial, user_emergency_info_dr_sharing: true };
    const payload = buildDirtyPayload(form, initial);

    expect(payload.user_emergency_info_dr_sharing).toBe(true);
  });

  it("includes numeric field changes", () => {
    const form = { ...initial, homeRegionId: 20 };
    const payload = buildDirtyPayload(form, initial);

    expect(payload.homeRegionId).toBe(20);
  });

  it("includes null-to-value changes for brought_by", () => {
    const form = { ...initial, brought_by: 5 };
    const payload = buildDirtyPayload(form, initial);

    expect(payload.brought_by).toBe(5);
  });

  it("includes all changed fields simultaneously", () => {
    const form: ProfileFormState = {
      ...initial,
      f3Name: "Updated",
      emergencyContact: "",
      user_emergency_info_dr_sharing: true,
      brought_by: 99,
    };
    const payload = buildDirtyPayload(form, initial);

    expect(Object.keys(payload)).toHaveLength(4);
    expect(payload.f3Name).toBe("Updated");
    expect(payload.emergencyContact).toBeNull();
    expect(payload.user_emergency_info_dr_sharing).toBe(true);
    expect(payload.brought_by).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// dirtyFieldClass
// ---------------------------------------------------------------------------

describe("dirtyFieldClass", () => {
  it("returns amber border class when dirty", () => {
    expect(dirtyFieldClass(true)).toContain("border-l-amber-500");
  });

  it("returns transparent border class when clean", () => {
    expect(dirtyFieldClass(false)).toContain("border-l-transparent");
  });

  it("always includes pl-2 for consistent spacing", () => {
    expect(dirtyFieldClass(true)).toContain("pl-2");
    expect(dirtyFieldClass(false)).toContain("pl-2");
  });
});
