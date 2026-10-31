#!/usr/bin/env node
// Keeps the review wiring honest:
// - every relative link in REVIEW.md resolves to an existing file and, when it
//   has one, an existing heading anchor (the critical checks link to the rule
//   they check, so a renamed section must not silently orphan a check);
// - .greptile/files.json lists REVIEW.md and every nested AGENTS.md, and
//   nothing that no longer exists. Each AGENTS.md is scoped to its own
//   directory (`<dir>/**`, plus any other paths its rules govern) or to paths
//   under it.
// - every CC-* and KP-* rule id named in .coderabbit.yaml or
//   .greptile/config.json is defined in REVIEW.md (`**CC-...` / `**KP-...`),
//   so renaming or deleting a rule can't leave a bot pointing at nothing.
// Run from the repo root, or pass a root directory as the first argument.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import process from "node:process";

const root = process.argv[2] ?? process.cwd();
const errors = [];

// GitHub's heading slugs keep letters, numbers, spaces, `-` and `_`.
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
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
  // Matches [text](target), [text](<target>) and [text](target "title").
  const links = /\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
  for (const [, target] of text.matchAll(links)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const [path, anchor] = target.split("#");
    const resolved = path ? normalize(join(dirname(file), path)) : file;
    if (!existsSync(resolved)) {
      errors.push(`${relFile}: link target ${target} does not exist`);
      continue;
    }
    if (!anchor) continue;
    if (!statSync(resolved).isFile()) {
      errors.push(`${relFile}: anchor on a directory link ${target}`);
    } else if (!anchorsOf(resolved).has(anchor)) {
      errors.push(
        `${relFile}: ${path || relFile} has no heading for #${anchor}`,
      );
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

function scopeIsValid(scope, dir) {
  if (!Array.isArray(scope) || scope.length === 0) return false;
  return (
    scope.includes(`${dir}/**`) ||
    scope.every((pattern) => pattern.startsWith(`${dir}/`))
  );
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
    const dir = dirname(agents);
    const entry = byPath.get(agents);
    if (!entry) {
      errors.push(`.greptile/files.json: ${agents} is not listed`);
    } else if (!scopeIsValid(entry.scope, dir)) {
      errors.push(
        `.greptile/files.json: ${agents} must be scoped to "${dir}/**" or to paths under ${dir}/`,
      );
    }
  }
}

function checkRuleIds() {
  const reviewPath = join(root, "REVIEW.md");
  if (!existsSync(reviewPath)) return;
  const ruleId = /\b(?:CC|KP)-[A-Z]+(?:-[A-Z]+)*\b/g;
  const defined = new Set(
    [
      ...readFileSync(reviewPath, "utf8").matchAll(
        /\*\*((?:CC|KP)-[A-Z-]*[A-Z])/g,
      ),
    ].map((match) => match[1]),
  );
  for (const config of [".coderabbit.yaml", ".greptile/config.json"]) {
    const configPath = join(root, config);
    if (!existsSync(configPath)) continue;
    const named = new Set(readFileSync(configPath, "utf8").match(ruleId) ?? []);
    for (const id of named) {
      if (!defined.has(id)) {
        errors.push(`${config}: ${id} is not defined in REVIEW.md`);
      }
    }
  }
}

checkLinks("REVIEW.md");
checkGreptile();
checkRuleIds();

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(
    "Fix the links, update .greptile/files.json (one entry per nested AGENTS.md, scoped to its directory), or rename the rule ids in the bot configs to match REVIEW.md.",
  );
  process.exit(1);
}
