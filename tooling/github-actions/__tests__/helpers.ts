import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file's location (tooling/github-actions/__tests__). */
export const REPO_ROOT = path.resolve(currentDir, "../../..");

/** Reads a file relative to the repo root and returns its raw text contents. */
export function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * Extracts a YAML "- item" list that immediately follows the given marker
 * (e.g. "options:"). Returns the trimmed item text for each list entry.
 */
export function extractYamlListAfter(content: string, marker: string): string[] {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return [];

  const after = content.slice(markerIndex + marker.length);
  const match = /^((?:\r?\n[ \t]*-[ \t].+)+)/.exec(after);
  if (!match) return [];

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

/**
 * Extracts the inline JS body of an `actions/github-script` `script: |`
 * block literal from a workflow YAML file, dedented so it can be executed
 * directly as a standalone script.
 */
export function extractGithubScript(workflowYaml: string): string {
  const match = /script:[ \t]*\|[ \t]*\r?\n([\s\S]+)$/.exec(workflowYaml);
  if (!match) {
    throw new Error("Could not find an inline `script: |` block in the workflow YAML.");
  }

  const block = match[1];
  const lines = block.split(/\r?\n/);
  const firstNonBlank = lines.find((line) => line.trim().length > 0);
  const indent = firstNonBlank ? /^[ \t]*/.exec(firstNonBlank)![0].length : 0;

  return lines.map((line) => line.slice(indent)).join("\n");
}

/**
 * Parses `new Map([['key', 'value'], ...])` entries out of a script source
 * string, without needing to execute the script.
 */
export function extractMapEntries(scriptSource: string, mapVariableName: string): [string, string][] {
  const mapMatch = new RegExp(`${mapVariableName}\\s*=\\s*new Map\\(\\[([\\s\\S]*?)\\]\\)`).exec(scriptSource);
  if (!mapMatch) return [];

  const entries: [string, string][] = [];
  const entryRegex = /\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRegex.exec(mapMatch[1])) !== null) {
    entries.push([entryMatch[1], entryMatch[2]]);
  }

  return entries;
}

/** The `AsyncFunction` constructor, used to build a runnable function from script source text. */
export const AsyncFunction = Object.getPrototypeOf(async function () {
  /* noop */
}).constructor as new (...args: string[]) => (...callArgs: unknown[]) => Promise<unknown>;