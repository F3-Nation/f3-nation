#!/usr/bin/env node
/**
 * Mirror vendor-neutral agent skills from .agents/skills/ (canonical,
 * checked in — see https://agentskills.io) into gitignored .claude/skills/,
 * which is the only project location Claude Code scans. Copies overwrite but
 * never delete, so local-only skills in .claude/skills/ survive. Runs from a
 * SessionStart hook (see .claude/settings.json); plain file copies keep this
 * working on Windows, where git symlinks aren't reliable.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = join(repoRoot, ".agents", "skills");
const target = join(repoRoot, ".claude", "skills");

if (existsSync(source)) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    cpSync(join(source, entry.name), join(target, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

// Ask Claude Code to re-scan skill directories so mirrored skills load in this session.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", reloadSkills: true },
  }) + "\n",
);
