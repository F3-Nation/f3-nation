#!/usr/bin/env node
// Fails when an eslint-suppressions.json gains a file/rule entry or a higher
// count than on the merge base. Baselines may only shrink; fix new violations
// instead of suppressing them. A baseline file new on this branch is not
// checked. Compares against TURBO_SCM_BASE in CI, else the merge base with
// origin/main; skips when neither resolves.

import { readFileSync } from "node:fs";
import process from "node:process";
import { spawnSync } from "node:child_process";

function git(...args) {
  const { status, stdout } = spawnSync("git", args, { encoding: "utf8" });
  return status === 0 ? stdout.trim() : null;
}

const base =
  process.env.TURBO_SCM_BASE || git("merge-base", "HEAD", "origin/main");
if (
  !base ||
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`) === null
) {
  console.log("check-eslint-suppressions: no base commit found; skipping.");
  process.exit(0);
}

const files = (git("ls-files", "*eslint-suppressions.json") ?? "")
  .split("\n")
  .filter(Boolean);

const offenders = [];
for (const path of files) {
  const baseSource = git("show", `${base}:${path}`);
  if (baseSource === null) continue;
  const before = JSON.parse(baseSource);
  const after = JSON.parse(readFileSync(path, "utf8"));
  for (const [file, rules] of Object.entries(after)) {
    for (const [rule, { count }] of Object.entries(rules)) {
      const was = before[file]?.[rule]?.count ?? 0;
      if (count > was) {
        offenders.push(`  - ${path}: ${file} ${rule} ${was} → ${count}`);
      }
    }
  }
}

if (offenders.length) {
  console.error(
    [
      "",
      "ESLint suppression baselines may only shrink. These entries grew:",
      ...offenders,
      "",
      "Fix the new violations instead of suppressing them. See",
      "tooling/eslint/react.js.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
