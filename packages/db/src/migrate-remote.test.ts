import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkGitState } from "./migrate-guards";
import {
  describeFailure,
  findMainRemote,
  migrationsFingerprint,
  PhaseError,
  readGitState,
} from "./migrate-remote";

// A throwaway "origin" plus a clone, so the git checks run against real git.
let dir: string;
let clone: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      // Ignore the developer's own git config (commit signing, hooksPath).
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();

const write = (repo: string, file: string, content: string) => {
  const full = path.join(repo, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
};

const commit = (repo: string, file: string, content: string, msg: string) => {
  write(repo, file, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
};

const state = () => readGitState(clone, "origin/main");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "migrate-guards-"));
  const origin = path.join(dir, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  commit(origin, "packages/db/drizzle/0000_a.sql", "create table a();", "a");
  commit(origin, "README.md", "hi", "readme");
  clone = path.join(dir, "clone");
  git(dir, "clone", "-q", origin, clone);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readGitState + checkGitState", () => {
  it("main is allowed", () => {
    expect(state()).toEqual({
      differsFromMain: false,
      localChanges: [],
      headOnMain: true,
    });
    expect(checkGitState(state())).toBeNull();
  });

  it("a branch with its own migration is refused (2026-10-08)", () => {
    git(clone, "switch", "-q", "-c", "user_role");
    commit(clone, "packages/db/drizzle/0001_b.sql", "alter table a;", "b");
    expect(state()).toMatchObject({ differsFromMain: true, headOnMain: false });
    expect(checkGitState(state())).toMatch(/not main's/);
  });

  it("a branch that doesn't touch migrations is allowed", () => {
    git(clone, "switch", "-q", "-c", "docs");
    commit(clone, "README.md", "changed", "docs");
    expect(checkGitState(state())).toBeNull();
  });

  it("an older commit of main (a release) is allowed", () => {
    const origin = path.join(dir, "origin");
    commit(origin, "packages/db/drizzle/0001_b.sql", "alter table a;", "b");
    git(clone, "fetch", "-q", "origin");
    // clone's HEAD is still the release commit, behind origin/main.
    expect(state()).toMatchObject({ differsFromMain: true, headOnMain: true });
    expect(checkGitState(state())).toBeNull();
  });

  it("an untracked migration file is refused", () => {
    write(clone, "packages/db/drizzle/0001_new.sql", "x");
    expect(state().localChanges).toEqual([
      "?? packages/db/drizzle/0001_new.sql",
    ]);
    expect(checkGitState(state())).toMatch(/uncommitted or untracked/);
  });

  it("an edited migration file is refused", () => {
    write(clone, "packages/db/drizzle/0000_a.sql", "create table b();");
    expect(checkGitState(state())).toMatch(/uncommitted or untracked/);
  });

  it("a broken index refuses instead of reading as no changes", () => {
    writeFileSync(path.join(clone, ".git/index"), "x");
    expect(state).toThrow(/git (diff|status) failed/);
  });
});

describe("findMainRemote", () => {
  it("finds the F3-Nation/f3-nation remote by URL, whatever its name", () => {
    git(clone, "remote", "rename", "origin", "fork");
    git(
      clone,
      "remote",
      "add",
      "upstream",
      "https://github.com/F3-Nation/f3-nation.git",
    );
    expect(findMainRemote(clone)).toBe("upstream");
  });

  it("finds none in an unrelated clone", () => {
    expect(findMainRemote(clone)).toBeUndefined();
  });

  it("ignores a lookalike host and a matching push URL", () => {
    git(
      clone,
      "remote",
      "add",
      "evil",
      "https://evil.example/F3-Nation/f3-nation.git",
    );
    git(clone, "remote", "add", "pushonly", "https://evil.example/x.git");
    git(
      clone,
      "remote",
      "set-url",
      "--push",
      "pushonly",
      "https://github.com/F3-Nation/f3-nation.git",
    );
    expect(findMainRemote(clone)).toBeUndefined();
  });
});

describe("migrationsFingerprint", () => {
  it("changes when a migration or the journal changes", () => {
    const folder = path.join(clone, "packages/db/drizzle");
    write(clone, "packages/db/drizzle/meta/_journal.json", "{}");
    const before = migrationsFingerprint(folder);
    expect(migrationsFingerprint(folder)).toBe(before);
    write(clone, "packages/db/drizzle/0000_a.sql", "create table b();");
    const edited = migrationsFingerprint(folder);
    expect(edited).not.toBe(before);
    write(clone, "packages/db/drizzle/meta/_journal.json", '{"x":1}');
    expect(migrationsFingerprint(folder)).not.toBe(edited);
  });
});

describe("describeFailure", () => {
  // What Drizzle throws for a failed statement: the SQL as the message, the
  // Postgres error as the cause.
  const pgError = Object.assign(new Error('column "x" already exists'), {
    code: "42701",
  });
  const drizzleError = new Error(
    `Failed query: alter table "a" add "x" int;\n${"--\n".repeat(500)}params: `,
    { cause: pgError },
  );

  it("prints the Postgres error under the migrating phase", () => {
    expect(
      describeFailure(new PhaseError("migrating", { cause: drizzleError })),
    ).toEqual([
      expect.stringMatching(/should have rolled back/),
      '  Failed query: alter table "a" add "x" int; ...',
      '  column "x" already exists',
      "    42701",
    ]);
  });

  it("says the migrations were applied when the check afterwards fails", () => {
    expect(
      describeFailure(
        new PhaseError("applied", { cause: new Error("boom") }),
      )[0],
    ).toMatch(/were applied/);
  });

  it("says nothing was changed for an error before migrating", () => {
    expect(describeFailure(new Error("connection dropped"))).toEqual([
      "Stopped before changing anything.",
      "  connection dropped",
    ]);
  });
});
