import { describe, expect, it } from "vitest";

import { getPgError, isForeignKeyViolationError } from "./user";

describe("isForeignKeyViolationError", () => {
  it.each([
    ["top-level 23503", { code: "23503" }, true],
    [
      "23503 wrapped in cause",
      new Error("x", { cause: { code: "23503" } }),
      true,
    ],
    ["unique violation", { code: "23505" }, false],
    [
      "wrapped unique violation",
      new Error("x", { cause: { code: "23505" } }),
      false,
    ],
    ["plain Error", new Error("x"), false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["string", "str", false],
    ["string cause", new Error("x", { cause: "23503" }), false],
  ])("%s -> %s", (_label, error, expected) => {
    expect(isForeignKeyViolationError(error)).toBe(expected);
  });
});

describe("getPgError", () => {
  it("returns the top-level error when it carries a code", () => {
    const error = { code: "23503", constraint_name: "attendance_user_id_fkey" };
    expect(getPgError(error)).toBe(error);
  });

  it("returns the cause when the driver wraps the Postgres error", () => {
    const cause = { code: "23503", constraint_name: "attendance_user_id_fkey" };
    expect(getPgError(new Error("x", { cause }))?.constraint_name).toBe(
      "attendance_user_id_fkey",
    );
  });

  it("returns undefined when there is no Postgres code", () => {
    expect(getPgError(new Error("x"))).toBeUndefined();
    expect(getPgError({ code: 23503 })).toBeUndefined();
  });
});
