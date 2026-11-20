#!/usr/bin/env node
// Fails when a Dockerfile fetches an npm package outside the pnpm lockfile
// unsafely. A global install (`npm install -g`, `pnpm add -g`, …) or a
// one-off run (`npx`, `pnpm dlx`) resolves against the registry at build time,
// so a floating version such as `turbo@2` pulls whatever release is newest into
// the image. Each such package must therefore:
//   - name an exact version (`corepack@0.36.0`, or an `${ARG}` whose default in
//     the same Dockerfile is exact), and
//   - not be a root package.json dependency: those are in the lockfile, with an
//     integrity hash, so the image installs them with `pnpm install` instead.
//
// Scans every Dockerfile (`Dockerfile`, `Dockerfile.*`, `*.Dockerfile`) that
// git tracks or would track (untracked but not ignored) under the working
// directory, so ignored checkouts such as `.claude/worktrees/` are skipped.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import process from "node:process";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const GLOBAL_INSTALL =
  /\b(?:npm(?:\s+-\S+)*\s+(?:install|i|add)|pnpm(?:\s+-\S+)*\s+(?:add|install|i)|yarn\s+global\s+add)\b([^&;|]*)/g;
const GLOBAL_FLAG = /\s(?:-g|--global|--location[= ]global)\s/;
const ONE_OFF_RUN =
  /\b(?:npx|npm\s+(?:exec|x)|pnpm\s+dlx|pnpx|yarn\s+dlx)\s+([^&;|]*)/g;

function isDockerfile(name) {
  return (
    name === "Dockerfile" ||
    name.startsWith("Dockerfile.") ||
    name.endsWith(".Dockerfile")
  );
}

function findDockerfiles() {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path && isDockerfile(basename(path)) && existsSync(path));
}

function rootDependencies() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync("package.json", "utf8"));
  } catch (error) {
    process.stderr.write(
      `check-dockerfile-global-installs: cannot read ./package.json (run it from the repo root): ${error.message}\n`,
    );
    process.exit(2);
  }
  return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
}

// Returns [{ line, text }] with backslash continuations joined onto the line
// they start on. Docker treats `#` as a comment only at the start of a line,
// and skips comment and blank lines inside a continuation.
function logicalLines(source) {
  const lines = [];
  let current = null;
  source.split("\n").forEach((raw, index) => {
    if (/^\s*(?:#|$)/.test(raw)) return;
    const text = raw;
    if (current) current.text += ` ${text}`;
    else current = { line: index + 1, text };
    if (!/\\\s*$/.test(text)) {
      lines.push(current);
      current = null;
    } else {
      current.text = current.text.replace(/\\\s*$/, "");
    }
  });
  if (current) lines.push(current);
  return lines;
}

function splitSpec(spec) {
  const at = spec.lastIndexOf("@");
  return at > 0
    ? { name: spec.slice(0, at), version: spec.slice(at + 1) }
    : { name: spec, version: "" };
}

function checkPackages(specs, args, rootDeps, report) {
  for (const raw of specs) {
    const spec = raw.replace(
      /\$\{(\w+)\}|\$(\w+)/g,
      (_, a, b) => args.get(a ?? b) ?? "",
    );
    const { name, version } = splitSpec(spec);
    if (rootDeps.has(name)) {
      report(
        `${raw} is a root package.json dependency; install it from the lockfile with pnpm instead`,
      );
    } else if (!EXACT_VERSION.test(version)) {
      report(`${raw} does not pin an exact version`);
    }
  }
}

function packageArgs(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token && !token.startsWith("-"));
}

const rootDeps = rootDependencies();
const problems = [];

// ARGs are scoped like Docker's: one declared before the first FROM is only a
// default, visible in a stage that repeats `ARG NAME`; each FROM starts a new
// stage with no ARGs.
const unquote = (value) => value.replace(/^"|"$/g, "");

for (const file of findDockerfiles()) {
  const globalArgs = new Map();
  let stageArgs = null; // null until the first FROM
  for (const { line, text } of logicalLines(readFileSync(file, "utf8"))) {
    if (/^\s*FROM\b/i.test(text)) {
      stageArgs = new Map();
      continue;
    }
    const arg = /^\s*ARG\s+(\w+)(?:=(\S*))?/i.exec(text);
    if (arg) {
      const [, name, value] = arg;
      if (stageArgs === null) {
        if (value !== undefined) globalArgs.set(name, unquote(value));
      } else {
        stageArgs.set(
          name,
          value !== undefined ? unquote(value) : globalArgs.get(name),
        );
      }
      continue;
    }
    if (!/^\s*RUN\b/i.test(text)) continue;
    const args = stageArgs ?? new Map();
    const report = (message) =>
      problems.push(`${relative(".", file)}:${line}: ${message}`);

    for (const match of text.matchAll(GLOBAL_INSTALL)) {
      if (!GLOBAL_FLAG.test(` ${match[0]} `) && !match[0].startsWith("yarn")) {
        continue;
      }
      const specs = packageArgs(match[1].replace(/--location\s+global/g, ""));
      checkPackages(specs, args, rootDeps, report);
    }
    for (const match of text.matchAll(ONE_OFF_RUN)) {
      const [first] = packageArgs(match[1]);
      if (first) checkPackages([first], args, rootDeps, report);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(
    "Dockerfiles that fetch npm packages outside the lockfile:\n" +
      problems.map((problem) => `  ${problem}\n`).join(""),
  );
  process.exit(1);
}
