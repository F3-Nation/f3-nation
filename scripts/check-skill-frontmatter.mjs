#!/usr/bin/env node
// Fails when a .agents/skills/*/SKILL.md frontmatter would not give a harness
// the skill's `name` and `description`. A harness decides whether to load a
// skill from those two fields alone, so a malformed one fails silently. The
// hazards are unquoted values: YAML drops everything after ` #` as a comment,
// and rejects `: ` as a nested mapping.
// Run from the repo root, or pass a root directory as the first argument.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.argv[2] ?? process.cwd();
const skillsDir = join(root, ".agents", "skills");
const errors = [];
let hazardFound = false;

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
    // YAML needs whitespace or end of line after the colon to read a key.
    const match = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (match) {
      fields.push({ key: match[1], first: (match[2] ?? "").trim(), rest: [] });
    } else if (/^\s+\S/.test(line) && fields.length > 0) {
      fields.at(-1).rest.push(line.trim());
    }
  }
  return fields;
}

// Returns the field's value, close enough to YAML's for the name and
// emptiness checks, and records the unquoted hazards as errors.
function fieldValue(rel, key, first, rest) {
  if (/^[|>]/.test(first)) return rest.join(" ");
  // A value may start on the line after its key.
  if (first === "" && /^['"]/.test(rest[0] ?? "")) {
    [first, ...rest] = rest;
  }
  if (/^['"]/.test(first)) {
    const quote = first[0];
    const quoted = [first, ...rest].join(" ");
    // The closing quote is the first one that is not escaped ('' or \").
    let end = -1;
    for (let i = 1; i < quoted.length && end === -1; i++) {
      if (quote === '"' && quoted[i] === "\\") i++;
      else if (quoted[i] !== quote) continue;
      else if (quote === "'" && quoted[i + 1] === "'") i++;
      else end = i;
    }
    if (end === -1) {
      errors.push(
        `${rel}: ${key} opens a ${quote} quote that never closes, so YAML rejects the frontmatter`,
      );
      return "";
    }
    // Also rejects a trailing comment: `'x' # note` looks the same as a
    // description truncated by a stray closing quote.
    if (quoted.slice(end + 1).trim() !== "") {
      errors.push(
        `${rel}: ${key} has text after its closing ${quote} quote, so YAML rejects or drops it; inside single quotes, write an apostrophe as ''`,
      );
      return "";
    }
    return unquote(quoted);
  }
  // A nested mapping or list, not a scalar.
  if (first === "" && /^(-\s|[\w-]+:(\s|$))/.test(rest[0] ?? "")) return "";
  const text = [first, ...rest].join(" ").trim();
  if (text.startsWith("#")) return "";
  if (/^([[\]{}*&!%@`,]|[-?]\s)/.test(text)) {
    hazardFound = true;
    errors.push(
      `${rel}: ${key} starts with ${text[0]}, which YAML reads as syntax, not text`,
    );
    return "";
  }
  if (/\s#/.test(text)) {
    hazardFound = true;
    errors.push(
      `${rel}: ${key} has an unquoted " #", so YAML drops the rest of the line as a comment`,
    );
  }
  if (/:(\s|$)/.test(text)) {
    hazardFound = true;
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
  if (hazardFound) {
    console.error(
      "Wrap the value in quotes; inside single quotes, write an apostrophe as ''.",
    );
  }
  process.exit(1);
}
