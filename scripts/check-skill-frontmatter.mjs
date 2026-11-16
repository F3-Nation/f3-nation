#!/usr/bin/env node
// Checks the YAML frontmatter of every .agents/skills/*/SKILL.md, because a
// harness decides whether to load a skill from its `name` and `description`
// alone and a malformed one fails silently:
// - the file opens with a `---` frontmatter block;
// - `name` equals the skill's directory name;
// - `description` is present and its YAML value is not empty (a value that is
//   only a comment, or a block scalar with no text, is empty);
// - no unquoted value contains ` #` (YAML starts a comment there and drops the
//   rest of the line) or `: ` (YAML reads it as a nested mapping), on its own
//   line or on an indented continuation line;
// - `.agents/skills` exists and holds at least one skill.
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

// Groups the frontmatter into fields: the text after `key:` and the indented
// lines that continue it.
function frontmatterFields(lines) {
  const fields = [];
  for (const line of lines) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) {
      fields.push({ key: match[1], first: match[2].trim(), rest: [] });
    } else if (/^\s+\S/.test(line) && fields.length > 0) {
      fields.at(-1).rest.push(line.trim());
    }
  }
  return fields;
}

// Returns the value YAML gives the field, reporting the unquoted hazards.
function fieldValue(rel, key, first, rest) {
  if (/^[|>]/.test(first)) return rest.join(" ");
  if (/^['"]/.test(first)) return unquote([first, ...rest].join(" "));
  // A nested mapping or list, not a scalar.
  if (first === "" && /^(-\s|[\w-]+:(\s|$))/.test(rest[0] ?? "")) return "";
  const text = [first, ...rest].join(" ").trim();
  if (text.startsWith("#")) return "";
  if (/\s#/.test(text)) {
    errors.push(
      `${rel}: ${key} has an unquoted " #", so YAML drops the rest of the line as a comment`,
    );
  }
  if (/:\s/.test(text)) {
    errors.push(
      `${rel}: ${key} has an unquoted ": ", which YAML reads as a nested mapping`,
    );
  }
  return text;
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
  for (const { key, first, rest } of frontmatterFields(lines)) {
    fields.set(key, fieldValue(rel, key, first, rest));
  }
  if (fields.get("name") !== name) {
    errors.push(`${rel}: name must be "${name}", the skill's directory name`);
  }
  if (!fields.get("description")) {
    errors.push(`${rel}: description is missing or empty`);
  }
}

if (existsSync(skillsDir)) {
  const skills = readdirSync(skillsDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  if (skills.length === 0) {
    errors.push(".agents/skills: no skill directories found");
  }
  for (const skill of skills) checkSkill(skill.name);
} else {
  errors.push(".agents/skills: directory is missing");
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(
    "Wrap the value in quotes; inside single quotes, write an apostrophe as ''.",
  );
  process.exit(1);
}
