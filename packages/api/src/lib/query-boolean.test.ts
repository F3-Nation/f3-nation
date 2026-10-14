import { describe, expect, it } from "vitest";

import { parseSorting, queryBooleanSchema } from "@acme/shared/app/functions";

describe("queryBooleanSchema", () => {
  it.each([
    { name: "boolean true", input: true, expected: true },
    { name: "boolean false", input: false, expected: false },
    { name: 'string "true"', input: "true", expected: true },
    { name: 'string "false"', input: "false", expected: false },
    { name: 'string "1"', input: "1", expected: true },
    { name: 'string "0"', input: "0", expected: false },
  ])("parses $name as $expected", ({ input, expected }) => {
    expect(queryBooleanSchema.parse(input)).toBe(expected);
  });

  it.each([
    { name: "undefined", input: undefined },
    { name: "null", input: null },
    { name: "numeric zero", input: 0 },
    { name: "numeric one", input: 1 },
    { name: "another number", input: -1 },
    { name: "an object", input: {} },
    { name: "an empty array", input: [] },
    { name: "a boolean array", input: [true] },
    { name: "a string array", input: ["false"] },
    { name: "an empty string", input: "" },
    { name: "uppercase true", input: "TRUE" },
    { name: "mixed-case false", input: "False" },
    { name: "leading whitespace", input: " true" },
    { name: "trailing whitespace", input: "false " },
    { name: "a padded number", input: "01" },
    { name: "yes", input: "yes" },
    { name: "on", input: "on" },
  ])("rejects $name instead of coercing it", ({ input }) => {
    expect(queryBooleanSchema.safeParse(input).success).toBe(false);
  });
});

describe("parseSorting", () => {
  const stringDirections = [
    { id: "name", desc: "false" },
    { id: "id", desc: "0" },
    { id: "created", desc: "true" },
    { id: "updated", desc: "1" },
  ];
  const normalizedDirections = [
    { id: "name", desc: false },
    { id: "id", desc: false },
    { id: "created", desc: true },
    { id: "updated", desc: true },
  ];

  it("preserves RPC boolean directions", () => {
    expect(parseSorting().parse(normalizedDirections)).toEqual(
      normalizedDirections,
    );
  });

  it.each([
    { name: "an object array", input: stringDirections },
    { name: "a JSON string", input: JSON.stringify(stringDirections) },
    {
      name: "a split JSON array",
      input: JSON.stringify(stringDirections).split(","),
    },
    {
      name: "individual JSON strings",
      input: stringDirections.map((direction) => JSON.stringify(direction)),
    },
  ])("normalizes string directions in $name", ({ input }) => {
    expect(parseSorting().parse(input)).toEqual(normalizedDirections);
  });

  it("defaults an omitted direction to ascending", () => {
    expect(parseSorting().parse('[{"id":"name"}]')).toEqual([
      { id: "name", desc: false },
    ]);
  });

  it.each([undefined, null])("keeps absent sorting optional (%s)", (input) => {
    expect(parseSorting().parse(input)).toBeUndefined();
  });

  it.each([
    { name: "null", desc: null },
    { name: "a number", desc: 1 },
    { name: "arbitrary text", desc: "yes" },
    { name: "an array", desc: [] },
  ])("rejects $name as a direction in JSON", ({ desc }) => {
    expect(
      parseSorting().safeParse(JSON.stringify([{ id: "name", desc }])).success,
    ).toBe(false);
  });
});
