#!/usr/bin/env node
/**
 * Mirror vendor-neutral agent skills from .agents/skills/ (canonical,
 * checked in — see https://agentskills.io) into gitignored .claude/skills/,
 * which is the only project location Claude Code scans. Copies overwrite (a
 * symlinked destination is unlinked and replaced by a real copy) but never
 * delete otherwise, so local-only skills in .claude/skills/ survive; only the
 * mirrors of skills listed in RETIRED_SKILLS are removed. Runs from a
 * SessionStart hook (see .claude/settings.json); plain file copies keep this
 * working on Windows, where git symlinks aren't reliable.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = join(repoRoot, ".agents", "skills");
const target = join(repoRoot, ".claude", "skills");

// Skills deleted from .agents/skills/. Their old mirrors would keep loading
// with instructions that point at files which no longer exist.
const RETIRED_SKILLS = ["github"];

for (const name of RETIRED_SKILLS) {
  rmSync(join(target, name), { recursive: true, force: true });
}

if (existsSync(source)) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dest = join(target, entry.name);
    // A symlink back to the source (the `skills` CLI leaves one) makes cpSync
    // throw; replace it with a real copy.
    if (lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()) {
      rmSync(dest);
    }
    cpSync(join(source, entry.name), dest, { recursive: true, force: true });
  }
}

// Ask Claude Code to re-scan skill directories so mirrored skills load in this session.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", reloadSkills: true },
  }) + "\n",
);
