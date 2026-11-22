"use strict";

// Run with: node --test .github/scripts/vendored-skills-check.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { classify } = require("./vendored-skills-check.cjs");

const SCRIPT = path.join(__dirname, "vendored-skills-check.cjs");
const ALL_CLEAR = "✓ All project skills are up to date";
const UPDATE =
  "↑ tdd has an update\n1 skill(s) can be updated; run npx skills update to install";
const MODIFIED =
  "✎ tdd has local changes\n1 skill(s) differ from skills-lock.json; run npx skills install --force to restore them";
const CLONE_FAILED =
  "✗ Failed to check for deleted skills from https://example.com/skills.git\nFailed to update 1 skill(s)";

test("the all-clear line with a zero exit is current", () => {
  assert.equal(
    classify(`Checking for skill updates…\n\n${ALL_CLEAR}\n`, 0),
    "current",
  );
});

test("the all-clear line with a non-zero exit is an error", () => {
  assert.equal(classify(`${ALL_CLEAR}\n`, 1), "error");
});

test("an upstream update is drift", () => {
  assert.equal(classify(`${UPDATE}\n`, 1), "drift");
});

test("a locally edited vendored file is drift", () => {
  assert.equal(classify(`${MODIFIED}\n`, 1), "drift");
});

test("a failed upstream check is an error", () => {
  assert.equal(classify(`${CLONE_FAILED}\n`, 1), "error");
});

test("a failure reported alongside drift is an error, not drift", () => {
  assert.equal(classify(`${CLONE_FAILED}\n${MODIFIED}\n`, 1), "error");
  assert.equal(classify(`${UPDATE}\n${CLONE_FAILED}\n`, 1), "error");
});

test("a source the CLI cannot update is an error", () => {
  const line =
    "✗ Cannot update skills.git: skills-lock.json is missing sourceUrl for this generic Git source";
  assert.equal(classify(`${line}\n${ALL_CLEAR}\n`, 0), "error");
});

test("output with no recognised line is an error", () => {
  assert.equal(classify("", 0), "error");
  assert.equal(classify("ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL\n", 1), "error");
});

test("a skill deleted upstream (exit 0, no all-clear line) is an error", () => {
  const deleted =
    "Warning: The following skills from mattpocock/skills appear to have been deleted upstream:\n  • tdd\nSkipping deletion in non-interactive mode.\n1 project skill(s) already up to date\n";
  assert.equal(classify(deleted, 0), "error");
});

test("an all-clear that skipped a lock entry without skillPath is an error", () => {
  const legacy =
    "1 project skill(s) cannot be updated automatically (installed before skillPath tracking):";
  assert.equal(classify(`${ALL_CLEAR}\n${legacy}\n`, 0), "error");
  assert.equal(
    classify(`No project skills can be updated in place.\n${legacy}\n`, 0),
    "error",
  );
});

test("the command prints the state for an output file and exit status", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vendored-skills-check-"));
  try {
    const file = path.join(dir, "out.txt");
    fs.writeFileSync(file, `${MODIFIED}\n`);
    assert.equal(
      execFileSync(process.execPath, [SCRIPT, file, "1"], { encoding: "utf8" }),
      "drift\n",
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("the command rejects a missing or non-numeric exit status", () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, "out.txt"]).status, 2);
  assert.equal(
    spawnSync(process.execPath, [SCRIPT, "out.txt", "abc"]).status,
    2,
  );
});
