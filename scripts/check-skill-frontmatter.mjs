#!/usr/bin/env node
// Checks the YAML frontmatter of every .agents/skills/*/SKILL.md, because a
// harness decides whether to load a skill from its `name` and `description`
// alone and a malformed one fails silently:
// - the file opens with a `---` frontmatter block;
// - `name` equals the skill's directory name;
// - `description` is present and not empty;
// - no unquoted value contains ` #` (YAML starts a comment there and drops the
//   rest of the line) or `: ` (YAML reads it as a nested mapping).
// Run from the repo root, or pass a root directory as the first argument.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.argv[2] ?? process.cwd();
const skillsDir = join(root, ".agents", "skills");
const errors = [];

function frontmatterLines(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  return end === -1 ? null : lines.slice(1, end);
}

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}

function checkSkill(name) {
  const rel = `.agents/skills/${name}/SKILL.md`;
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    errors.push(`${rel}: file is missing`);
    return;
  }
  const lines = frontmatterLines(readFileSync(file, "utf8"));
  if (!lines) {
    errors.push(`${rel}: no frontmatter block between two --- lines`);
    return;
  }
  const fields = new Map();
  for (const line of lines) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim();
    const plain = value !== "" && !/^['">|]/.test(value);
    if (plain && /\s#/.test(value)) {
      errors.push(
        `${rel}: ${key} has an unquoted " #", so YAML drops the rest of the line as a comment`,
      );
    }
    if (plain && /:\s/.test(value)) {
      errors.push(
        `${rel}: ${key} has an unquoted ": ", which YAML reads as a nested mapping`,
      );
    }
    fields.set(key, unquote(value));
  }
  if (fields.get("name") !== name) {
    errors.push(`${rel}: name must be "${name}", the skill's directory name`);
  }
  if (!fields.get("description")) {
    errors.push(`${rel}: description is missing or empty`);
  }
}

if (existsSync(skillsDir)) {
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) checkSkill(entry.name);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(
    "Wrap the value in quotes; inside single quotes, write an apostrophe as ''.",
  );
  process.exit(1);
}
