# CLAUDE.md

> Entry point for Claude Code working in this repository.

This repository uses the **`AGENTS.md` standard** as the single source of truth
for AI coding guidance. Read these, in order:

1. [`AGENTS.md`](AGENTS.md) — canonical repository conventions (structure, build
   & test commands, environment setup, coding style, commit conventions).
2. [`docs/AI_GUARDRAILS.md`](docs/AI_GUARDRAILS.md) — operating boundaries
   (Always / Never / Can) and the human-owned domains (security,
   availability/reliability, scalability).
3. [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md) — secure
   patterns and pitfalls to avoid (API authorization, auth/tokens, secrets, web
   security, data layer, multi-instance reliability) plus a pre-flight checklist
   for every change.
4. The relevant per-app guide, e.g. [`apps/me/AGENTS.md`](apps/me/AGENTS.md) or
   [`apps/auth/AGENTS.md`](apps/auth/AGENTS.md).

If you are asked to **audit** the repo and file issues, follow
[`docs/AI_AUDIT_PLAYBOOK.md`](docs/AI_AUDIT_PLAYBOOK.md).

Project-specific Claude skills and commands live under
[`.claude/`](.claude/). Keep this file thin — put durable guidance in
`AGENTS.md` or `docs/`, not here.
