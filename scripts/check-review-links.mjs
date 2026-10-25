#!/usr/bin/env node
// Keeps the review wiring honest:
// - every relative link in REVIEW.md resolves to an existing file and, when it
//   has one, an existing heading anchor (the critical checks link to the rule
//   they check, so a renamed section must not silently orphan a check);
// - .greptile/files.json lists REVIEW.md and every nested AGENTS.md, each
//   scoped to its own directory, and nothing that no longer exists.
// Run from the repo root, or pass a root directory as the first argument.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import process from "node:process";

const root = process.argv[2] ?? process.cwd();
const errors = [];

function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function anchorsOf(file) {
  const seen = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (!match) continue;
    const base = slugify(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function checkLinks(relFile) {
  const file = join(root, relFile);
  if (!existsSync(file)) {
    errors.push(`${relFile}: file is missing`);
    return;
  }
  const text = readFileSync(file, "utf8");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    const [path, anchor] = target.split("#");
    const resolved = normalize(join(dirname(file), path));
    if (!existsSync(resolved)) {
      errors.push(`${relFile}: link target ${target} does not exist`);
      continue;
    }
    if (anchor && !anchorsOf(resolved).has(anchor)) {
      errors.push(`${relFile}: ${path} has no heading for #${anchor}`);
    }
  }
}

function trackedAgentsFiles() {
  const out = execFileSync("git", ["ls-files", "*AGENTS.md"], {
    cwd: root,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((path) => path && path !== "AGENTS.md")
    .filter((path) => !path.includes("node_modules/"));
}

function checkGreptile() {
  const configPath = join(root, ".greptile/files.json");
  if (!existsSync(configPath)) {
    errors.push(".greptile/files.json is missing");
    return;
  }
  const entries = JSON.parse(readFileSync(configPath, "utf8")).files ?? [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    if (!existsSync(join(root, entry.path))) {
      errors.push(`.greptile/files.json: ${entry.path} does not exist`);
    }
  }
  if (!byPath.has("REVIEW.md")) {
    errors.push(".greptile/files.json: REVIEW.md is not listed");
  }
  for (const agents of trackedAgentsFiles()) {
    const expected = `${dirname(agents)}/**`;
    const entry = byPath.get(agents);
    if (!entry) {
      errors.push(`.greptile/files.json: ${agents} is not listed`);
    } else if (JSON.stringify(entry.scope) !== JSON.stringify([expected])) {
      errors.push(
        `.greptile/files.json: ${agents} must be scoped to ["${expected}"]`,
      );
    }
  }
}

checkLinks("REVIEW.md");
checkGreptile();

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(
    "Fix the links or regenerate .greptile/files.json (one entry per nested AGENTS.md, scoped to its directory).",
  );
  process.exit(1);
}
