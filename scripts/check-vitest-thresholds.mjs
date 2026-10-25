#!/usr/bin/env node
// Fails when a vitest.config.ts declares coverage thresholds without
// `autoUpdate: true`. See AGENTS.md § Testing Guidelines for the rationale.
// Pass file paths as args to check only those (used by the lefthook job).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";

const WORKSPACE_ROOTS = ["apps", "packages", "tooling"];
const CONFIG_NAMES = ["vitest.config.ts", "vitest.config.mts"];
const HAS_THRESHOLDS = /thresholds\s*:\s*\{/;
const HAS_AUTO_UPDATE = /autoUpdate\s*:\s*true/;

function discoverConfigs() {
  return WORKSPACE_ROOTS.flatMap((root) => {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        CONFIG_NAMES.map((name) => join(root, entry.name, name)),
      )
      .filter((path) => existsSync(path));
  });
}

const args = process.argv.slice(2);
const configs = args.length
  ? args.filter(
      (path) => CONFIG_NAMES.includes(basename(path)) && existsSync(path),
    )
  : discoverConfigs();

const offenders = configs.filter((path) => {
  const source = readFileSync(path, "utf8");
  return HAS_THRESHOLDS.test(source) && !HAS_AUTO_UPDATE.test(source);
});

if (offenders.length) {
  console.error(
    [
      "",
      "Coverage thresholds must ratchet automatically.",
      "",
      "These configs declare `test.coverage.thresholds` without `autoUpdate: true`:",
      ...offenders.map((path) => `  - ${path}`),
      "",
      "Restore `autoUpdate: true` inside the thresholds block. Vitest rewriting",
      "the numbers after a test run is expected — commit that change, don't",
      "disable the flag. Lowering or freezing thresholds to make a suite pass is",
      "not an acceptable fix. See AGENTS.md § Testing Guidelines.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
