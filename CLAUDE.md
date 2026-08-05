# CLAUDE.md

Entry point for Claude Code in this repository.

@AGENTS.md

A script lives in `.claude/scripts/sync-agent-skills.mjs` that is triggered by `.claude/settings.json` on startup. The script copies skills from `.agents/skills` to `.claude/skills`. Add or edit skills in `.agents/skills` only; `.claude/skills` is generated and gitignored, so never commit anything under it.