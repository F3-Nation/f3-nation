"use strict";

// Sorts the output of `pnpm skills:check` for the vendored-skills workflow.
// Usage: node vendored-skills-check.cjs <output file> <exit status>
// Prints one of: current, drift, error.

const ALL_CLEAR = "All project skills are up to date";
const DRIFT = /can be updated|differ from skills-lock\.json/;
// The CLI marks a source it could not check with ✗, and counts the skills it
// could not update.
const FAILURE = /✗|Failed to |Cannot update /;

/**
 * Fails closed: only the all-clear line with a zero exit counts as current,
 * and a failure line outranks a drift line, because the CLI can print both in
 * one run (a clone fails while a vendored file was edited locally).
 */
function classify(output, exitStatus) {
  if (FAILURE.test(output)) return "error";
  if (exitStatus === 0 && output.includes(ALL_CLEAR)) return "current";
  if (DRIFT.test(output)) return "drift";
  return "error";
}

module.exports = { classify };

if (require.main === module) {
  const fs = require("node:fs");
  const [file, status] = process.argv.slice(2);
  if (!file || !/^\d+$/.test(status ?? "")) {
    console.error(
      "usage: vendored-skills-check.cjs <output file> <exit status>",
    );
    process.exit(2);
  }
  process.stdout.write(
    `${classify(fs.readFileSync(file, "utf8"), Number(status))}\n`,
  );
}
