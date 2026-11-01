import { describe, expect, it } from "vitest";

import type { MigrationPlan } from "./migrate-guards";
import {
  findFailedStatement,
  planProblems,
  summarizeStatement,
  workflowCommand,
} from "./migrate-check";

const BREAKPOINT = "--> statement-breakpoint";

const plan = (over: Partial<MigrationPlan> = {}): MigrationPlan => ({
  pending: [],
  unknownRows: [],
  skipped: [],
  knownSkipped: [],
  hashMismatches: [],
  ...over,
});

describe("findFailedStatement", () => {
  it("finds the tag and line of a statement that is not first in its file", () => {
    const files = [
      {
        tag: "0001_add_b",
        content: `CREATE TABLE a (id int);\n${BREAKPOINT}\n-- backfill b\nALTER TABLE a ADD COLUMN b int;\n`,
      },
    ];
    const query = "\n-- backfill b\nALTER TABLE a ADD COLUMN b int;\n";

    expect(findFailedStatement(files, query)).toEqual({
      tag: "0001_add_b",
      line: 4,
      statement: query,
    });
  });

  it("counts lines across a multi-line earlier statement", () => {
    const files = [
      {
        tag: "0002_multi",
        content: `CREATE TABLE a (\n  id int\n);\n${BREAKPOINT}\nALTER TABLE a ADD b int;\n`,
      },
    ];
    const query = "\nALTER TABLE a ADD b int;\n";

    expect(findFailedStatement(files, query)?.line).toBe(5);
  });

  it("reports line 1 for the first statement in a file", () => {
    const files = [
      {
        tag: "0003_first",
        content: `ALTER TABLE a ADD x int;\n${BREAKPOINT}\nALTER TABLE a ADD y int;\n`,
      },
    ];

    expect(findFailedStatement(files, "ALTER TABLE a ADD x int;\n")).toEqual({
      tag: "0003_first",
      line: 1,
      statement: "ALTER TABLE a ADD x int;\n",
    });
  });

  it("skips a leading comment when the first statement of a file is found", () => {
    const content = "-- header\nCREATE TABLE b ();\n";
    const files = [{ tag: "0004_header", content }];

    expect(findFailedStatement(files, content)?.line).toBe(2);
  });

  it("prefers the later file when two files contain an identical statement", () => {
    const files = [
      { tag: "0005_old", content: "ALTER TABLE a ADD x int;\n" },
      { tag: "0006_new", content: "ALTER TABLE a ADD x int;\n" },
    ];

    expect(findFailedStatement(files, "ALTER TABLE a ADD x int;\n")).toEqual({
      tag: "0006_new",
      line: 1,
      statement: "ALTER TABLE a ADD x int;\n",
    });
  });

  it("returns undefined when no piece equals the query exactly", () => {
    const files = [{ tag: "0007_a", content: "SELECT 1;\n" }];

    expect(findFailedStatement(files, "SELECT 2;")).toBeUndefined();
    expect(findFailedStatement(files, "SELECT 1;")).toBeUndefined();
    expect(findFailedStatement([], "SELECT 1;")).toBeUndefined();
  });
});

describe("summarizeStatement", () => {
  it("drops comment lines, collapses whitespace and trims", () => {
    const statement = [
      "-- header",
      "CREATE TABLE  a (",
      "    id   int,",
      "  -- inline",
      "  name text",
      ");",
    ].join("\n");

    expect(summarizeStatement(statement)).toBe(
      "CREATE TABLE a ( id int, name text );",
    );
  });

  it("returns a statement within the limit unchanged", () => {
    expect(summarizeStatement("SELECT 1;", 10)).toBe("SELECT 1;");
    expect(summarizeStatement("abcde", 5)).toBe("abcde");
  });

  it("truncates a longer statement to max characters plus ' ...'", () => {
    expect(summarizeStatement("abcdefghij", 5)).toBe("abcde ...");
  });

  it("truncates at 200 characters by default", () => {
    expect(summarizeStatement("a".repeat(250))).toBe(`${"a".repeat(200)} ...`);
  });
});

describe("workflowCommand", () => {
  it("formats an annotation with file and line properties", () => {
    expect(workflowCommand("error", "msg", { file: "a.sql", line: 3 })).toBe(
      "::error file=a.sql,line=3::msg",
    );
  });

  it("omits the properties section when there are none", () => {
    expect(workflowCommand("warning", "msg")).toBe("::warning::msg");
  });

  it("escapes percent, carriage return and newline in the message", () => {
    expect(workflowCommand("error", "100% done\r\nnext")).toBe(
      "::error::100%25 done%0D%0Anext",
    );
  });

  it("leaves colons and commas unescaped in the message", () => {
    expect(workflowCommand("error", "a: b, c")).toBe("::error::a: b, c");
  });

  it("escapes colon, comma and percent in property values", () => {
    expect(workflowCommand("error", "m", { title: "x:y,z%" })).toBe(
      "::error title=x%3Ay%2Cz%25::m",
    );
  });

  it("escapes newlines in property values", () => {
    expect(workflowCommand("error", "m", { title: "a\nb" })).toBe(
      "::error title=a%0Ab::m",
    );
  });

  it("keeps property order and joins them with commas", () => {
    expect(
      workflowCommand("error", "m", { file: "a.sql", line: 3, title: "T" }),
    ).toBe("::error file=a.sql,line=3,title=T::m");
  });
});

describe("planProblems", () => {
  it("reports nothing for an empty plan", () => {
    expect(planProblems(plan())).toEqual({ errors: [], warnings: [] });
  });

  it("makes an error of each unknown applied row", () => {
    const problems = planProblems(
      plan({
        unknownRows: [
          { createdAt: 1700000000000, hash: "h1" },
          { createdAt: 1700000000001, hash: "h2" },
        ],
      }),
    );

    expect(problems.warnings).toEqual([]);
    expect(problems.errors).toHaveLength(2);
    expect(problems.errors[0]).toContain("when 1700000000000");
    expect(problems.errors[1]).toContain("when 1700000000001");
  });

  it("makes an error naming the tag of each skipped entry", () => {
    const problems = planProblems(
      plan({
        skipped: [
          { tag: "0004_late", when: 1000 },
          { tag: "0005_later", when: 2000 },
        ],
      }),
    );

    expect(problems.warnings).toEqual([]);
    expect(problems.errors).toHaveLength(2);
    expect(problems.errors[0]).toMatch(/^0004_late: /);
    expect(problems.errors[0]).toContain('"when" (1000)');
    expect(problems.errors[1]).toMatch(/^0005_later: /);
  });

  it("makes a warning of each hash mismatch", () => {
    const problems = planProblems(
      plan({
        hashMismatches: [
          { tag: "0002_edited", when: 500 },
          { tag: "0003_edited", when: 600 },
        ],
      }),
    );

    expect(problems.errors).toEqual([]);
    expect(problems.warnings).toHaveLength(2);
    expect(problems.warnings[0]).toMatch(
      /^0002_edited differs from the base's copy/,
    );
    expect(problems.warnings[1]).toMatch(/^0003_edited differs/);
  });

  it("reports unknown rows and skipped entries as errors and mismatches as warnings together", () => {
    const problems = planProblems(
      plan({
        unknownRows: [{ createdAt: 1, hash: "h" }],
        skipped: [{ tag: "0008_skip", when: 2 }],
        hashMismatches: [{ tag: "0009_hash", when: 3 }],
      }),
    );

    expect(problems.errors).toHaveLength(2);
    expect(problems.warnings).toHaveLength(1);
  });
});
