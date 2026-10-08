import { describe, expect, it } from "vitest";

import type { AppliedRow, JournalEntry } from "./migrate-guards";
import {
  checkGitState,
  checkPlan,
  classifyHost,
  confirmationMatches,
  ENVIRONMENTS,
  isMainRepoUrl,
  isProtectedDatabaseName,
  maintenanceUrl,
  planMigrations,
} from "./migrate-guards";

describe("classifyHost", () => {
  it.each([
    "postgresql://f3local:f3local@localhost:5433/f3nation",
    "postgresql://u:p@127.0.0.1:5432/f3nation",
    "postgresql://u:p@[::1]:5432/f3nation",
    "postgresql://u:p@LOCALHOST/f3nation",
    "postgresql://u:p@localhost/f3nation?host=/var/run/postgresql",
    "postgresql://u:p@localhost/f3nation?host=%2Ftmp",
    // An empty host with a local socket: postgresArgs and libpq accept it.
    "postgresql://u:p@/f3nation?host=/var/run/postgresql",
  ])("local: %s", (url) => {
    expect(classifyHost(url)).toBe("local");
  });

  it.each([
    "postgresql://u:p@34.66.1.2:5432/f3_prod",
    "postgresql://u:p@db.example.com/f3nation",
    "postgresql://u:p@localhost/f3_prod?host=/cloudsql/f3data:us-central1:f3data",
    "postgresql://u:p@localhost/f3_prod?host=%2Fcloudsql%2Ff3data%3Aus-central1%3Af3data",
    // libpq lets a TCP host= override the URL's host.
    "postgresql://u:p@localhost/f3nation?host=10.0.0.5",
    // Unparseable: never assumed local.
    "postgresql://u:p@/f3_prod?host=/cloudsql/f3data:us-central1:f3data",
    "not a url",
  ])("remote: %s", (url) => {
    expect(classifyHost(url)).toBe("remote");
  });
});

describe("maintenanceUrl", () => {
  it.each([
    [
      "postgresql://f3local:f3local@localhost:5433/f3nation",
      "postgresql://f3local:f3local@localhost:5433/postgres",
    ],
    // A user named like the database keeps its name.
    [
      "postgresql://f3nation:pw@localhost/f3nation",
      "postgresql://f3nation:pw@localhost/postgres",
    ],
    [
      "postgresql://u:p@/f3nation?host=/var/run/postgresql",
      "postgresql://u:p@/postgres?host=/var/run/postgresql",
    ],
    [
      "postgresql://u:p@localhost/f3nation?sslmode=disable",
      "postgresql://u:p@localhost/postgres?sslmode=disable",
    ],
  ])("%s", (url, expected) => {
    expect(maintenanceUrl(url)).toBe(expected);
  });
});

describe("isMainRepoUrl", () => {
  it.each([
    "https://github.com/F3-Nation/f3-nation.git",
    "https://github.com/F3-Nation/f3-nation",
    "https://github.com/f3-nation/f3-nation/",
    "git@github.com:F3-Nation/f3-nation.git",
    "ssh://git@github.com/F3-Nation/f3-nation.git",
  ])("main: %s", (url) => {
    expect(isMainRepoUrl(url)).toBe(true);
  });
  it.each([
    "https://gitlab.com/F3-Nation/f3-nation.git",
    "https://github.com.evil.example/F3-Nation/f3-nation.git",
    "https://evil.example/github.com/F3-Nation/f3-nation.git",
    "file:///tmp/F3-Nation/f3-nation",
    "/tmp/F3-Nation/f3-nation",
    "git@evil.example:F3-Nation/f3-nation.git",
    "https://github.com/someone/F3-Nation/f3-nation.git",
    "https://github.com/F3-Nation/f3-nation-fork.git",
    "http://github.com/F3-Nation/f3-nation.git",
  ])("not main: %s", (url) => {
    expect(isMainRepoUrl(url)).toBe(false);
  });
});

describe("isProtectedDatabaseName", () => {
  it.each([
    "f3_prod",
    "f3_staging",
    "F3_PROD",
    "my-prod",
    "staging",
    "x_production",
  ])("protects %s", (name) => {
    expect(isProtectedDatabaseName(name)).toBe(true);
  });
  it.each([
    "f3nation",
    "f3nation_test",
    "f3_copy",
    "nonprod_thing",
    "products",
  ])("allows %s", (name) => {
    expect(isProtectedDatabaseName(name)).toBe(false);
  });
});

describe("checkGitState", () => {
  const clean = { differsFromMain: false, localChanges: [], headOnMain: true };

  it("allows main itself", () => {
    expect(checkGitState(clean)).toBeNull();
  });

  it("allows a branch whose migrations are main's", () => {
    expect(checkGitState({ ...clean, headOnMain: false })).toBeNull();
  });

  it("allows a release commit on main that is behind main", () => {
    expect(checkGitState({ ...clean, differsFromMain: true })).toBeNull();
  });

  it("refuses a branch with migrations main doesn't have (2026-10-08)", () => {
    expect(
      checkGitState({ ...clean, differsFromMain: true, headOnMain: false }),
    ).toMatch(/not main's/);
  });

  it("refuses local changes, even on main", () => {
    const refusal = checkGitState({
      ...clean,
      localChanges: ["?? packages/db/drizzle/0031_new.sql"],
    });
    expect(refusal).toMatch(/uncommitted or untracked/);
    expect(refusal).toContain("0031_new.sql");
  });
});

describe("planMigrations / checkPlan", () => {
  const journal: JournalEntry[] = [
    { tag: "0000_a", when: 100 },
    { tag: "0001_b", when: 200 },
    { tag: "0002_c", when: 300 },
    { tag: "0003_d", when: 400 },
  ];
  const hashes = new Map([
    [100, "h0"],
    [200, "h1"],
    [300, "h2"],
    [400, "h3"],
  ]);
  const rows = (...whens: number[]): AppliedRow[] =>
    whens.map((w) => ({ createdAt: w, hash: hashes.get(w) ?? "x" }));

  it("pending = entries newer than the newest applied row", () => {
    const plan = planMigrations(journal, rows(100, 200), hashes, []);
    expect(plan.pending.map((e) => e.tag)).toEqual(["0002_c", "0003_d"]);
    expect(checkPlan(plan, "f3_staging")).toBeNull();
  });

  it("nothing pending when up to date", () => {
    const plan = planMigrations(journal, rows(100, 200, 300, 400), hashes, []);
    expect(plan.pending).toEqual([]);
    expect(checkPlan(plan, "f3_prod")).toBeNull();
  });

  it("refuses rows newer than main's newest migration (2026-10-08)", () => {
    const plan = planMigrations(
      journal,
      [...rows(100, 200, 300, 400), { createdAt: 500, hash: "branch" }],
      hashes,
      [],
    );
    expect(plan.unknownRows).toEqual([{ createdAt: 500, hash: "branch" }]);
    expect(checkPlan(plan, "f3_prod")).toMatch(
      /migration\(s\) this checkout doesn't know about/,
    );
  });

  it("refuses unknown rows older than main's newest, too", () => {
    const plan = planMigrations(
      journal,
      [...rows(100, 200), { createdAt: 250, hash: "?" }],
      hashes,
      [],
    );
    expect(checkPlan(plan, "f3_staging")).toMatch(/doesn't know about/);
  });

  it("refuses an entry Drizzle would silently skip", () => {
    // 0001_b missing while 0002_c is applied: its when <= the newest row.
    const plan = planMigrations(journal, rows(100, 300), hashes, []);
    expect(plan.skipped.map((e) => e.tag)).toEqual(["0001_b"]);
    expect(plan.pending.map((e) => e.tag)).toEqual(["0003_d"]);
    expect(checkPlan(plan, "f3_prod")).toMatch(/silently\s+skip/);
  });

  it("allows a skipped entry that is known for this database", () => {
    const plan = planMigrations(journal, rows(100, 300), hashes, ["0001_b"]);
    expect(plan.skipped).toEqual([]);
    expect(plan.knownSkipped.map((e) => e.tag)).toEqual(["0001_b"]);
    expect(checkPlan(plan, "f3_prod")).toBeNull();
  });

  it("only notes a hash that changed after the migration ran", () => {
    const plan = planMigrations(
      journal,
      [{ createdAt: 100, hash: "edited" }, ...rows(200)],
      hashes,
      [],
    );
    expect(plan.hashMismatches.map((e) => e.tag)).toEqual(["0000_a"]);
    expect(checkPlan(plan, "f3_prod")).toBeNull();
  });

  it("an empty database gets every migration", () => {
    const plan = planMigrations(journal, [], hashes, []);
    expect(plan.pending).toHaveLength(4);
  });

  it("prod's known skip is 0008_nice_leech only", () => {
    expect(ENVIRONMENTS.prod.knownSkipped).toEqual(["0008_nice_leech"]);
    expect(ENVIRONMENTS.staging.knownSkipped).toEqual([]);
  });
});

describe("confirmationMatches", () => {
  it("needs the exact database name", () => {
    expect(confirmationMatches("f3_prod", "f3_prod")).toBe(true);
    expect(confirmationMatches("  f3_prod\n", "f3_prod")).toBe(true);
    expect(confirmationMatches("y", "f3_prod")).toBe(false);
    expect(confirmationMatches("F3_PROD", "f3_prod")).toBe(false);
    expect(confirmationMatches("f3_staging", "f3_prod")).toBe(false);
  });
});
