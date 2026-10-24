#!/usr/bin/env node
// Runs `eslint --fix` over staged files, one process per eslint.config.js.
// ESLint 10 resolves config from each file's directory, so a single root
// invocation loads one type-aware TypeScript Program per workspace at once and
// exhausts the heap. Batching keeps peak memory at one workspace's worth.
// Suppressions for violations the staged files no longer have are pruned and
// the workspace's eslint-suppressions.json is staged with them. Workspaces
// without a baseline are never pruned, since ESLint would create an empty one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG_NAMES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
];

function nearestConfigDir(file) {
  let dir = dirname(resolve(ROOT, file));
  while (dir.startsWith(ROOT)) {
    if (CONFIG_NAMES.some((name) => existsSync(join(dir, name)))) return dir;
    if (dir === ROOT) break;
    dir = dirname(dir);
  }
  return ROOT;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function eslintBin(dir) {
  const local = join(dir, "node_modules", ".bin", "eslint");
  return existsSync(local)
    ? local
    : join(ROOT, "node_modules", ".bin", "eslint");
}

const files = process.argv.slice(2).filter((file) => existsSync(file));
if (!files.length) process.exit(0);

const buckets = new Map();
for (const file of files) {
  const dir = nearestConfigDir(file);
  if (!buckets.has(dir)) buckets.set(dir, []);
  buckets.get(dir).push(relative(dir, resolve(ROOT, file)));
}

const failed = [];
for (const [dir, bucketFiles] of buckets) {
  const label = relative(ROOT, dir) || ".";
  const cache = join(
    ROOT,
    "node_modules/.cache/lint-staged",
    `${label.split(sep).join("-")}.eslintcache`,
  );
  const suppressions = join(dir, "eslint-suppressions.json");
  const suppressionsBefore = readIfExists(suppressions);
  if (
    suppressionsBefore !== null &&
    spawnSync("git", ["diff", "--quiet", "--", suppressions]).status !== 0
  ) {
    console.error(
      `${relative(ROOT, suppressions)} has unstaged changes; stage or discard them before committing.`,
    );
    failed.push(label);
    continue;
  }
  const { status } = spawnSync(
    eslintBin(dir),
    [
      "--fix",
      ...(suppressionsBefore === null ? [] : ["--prune-suppressions"]),
      "--no-warn-ignored",
      "--cache",
      "--cache-location",
      cache,
      ...bucketFiles,
    ],
    { cwd: dir, stdio: "inherit" },
  );
  if (status !== 0) {
    // ESLint prunes even on failure, and a parse error drops every entry for
    // that file.
    failed.push(label);
    if (suppressionsBefore !== null) {
      writeFileSync(suppressions, suppressionsBefore);
    }
    continue;
  }
  if (readIfExists(suppressions) !== suppressionsBefore) {
    const prettier = spawnSync(
      join(ROOT, "node_modules", ".bin", "prettier"),
      ["--write", "--log-level", "warn", suppressions],
      { stdio: "inherit" },
    );
    if (prettier.status !== 0) {
      console.error(`prettier failed on ${relative(ROOT, suppressions)}`);
      if (suppressionsBefore !== null) {
        writeFileSync(suppressions, suppressionsBefore);
      }
      failed.push(label);
      continue;
    }
    const add = spawnSync("git", ["add", "--", suppressions], {
      stdio: "inherit",
    });
    if (add.status !== 0) {
      console.error(`git add failed on ${relative(ROOT, suppressions)}`);
      failed.push(label);
    }
  }
}

if (failed.length) {
  console.error(`\nlint-staged failed in: ${failed.join(", ")}\n`);
  process.exit(1);
}
