import { readFileSync } from "node:fs";

/**
 * Shared CLI-argument helpers for the ci-factory entry points (review-pr.ts,
 * triage-e2e-failure.ts). Both parse `--flag value` / `--flag=value` args and
 * read required input files the same way — keep the single copy here so the two
 * commands can't drift.
 */

/** Read a `--flag value` or `--flag=value` argument from argv. */
export function flagValue(name: string): string | undefined {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  if (idx !== -1) return process.argv[idx + 1];
  return undefined;
}

/** Read a required file whose path came from a CLI flag; throws if unset. */
export function readRequiredFile(
  label: string,
  filePath: string | undefined,
): string {
  if (!filePath) {
    throw new Error(`Missing required flag: --${label} <path>`);
  }
  return readFileSync(filePath, "utf8");
}
