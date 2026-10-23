# Copilot instructions

`AGENTS.md` is the canonical source for repo conventions and Copilot loads it
alongside this file. This file adds review priorities that apply everywhere.
Rules for specific paths live in `.github/instructions/*.instructions.md`.
When two rules conflict, the stricter one wins.

## What to look for first

The defects that reached `main` here were mostly logic and authorization
mistakes, not style. Review in this order:

1. **Authorization and data exposure.** Every handler that takes an id must
   check the caller against the org that owns the fetched row and against any
   target org. Anonymous paths must not return private, inactive or personal
   data.
2. **Silent failure.** Look for a `catch` that swallows the error, a script
   that exits 0 on failure, a gate that passes after checking nothing, or a
   fallback that hides an outage.
3. **Atomicity.** Look for read-then-write races, related writes made outside
   one transaction, and one-time flags set before the side effect succeeds.
4. **Cross-boundary breakage.** Check every caller of a changed contract:
   the Slack bot's Python API client, map/admin/me hooks, the OpenAPI golden,
   deploy workflows and Dockerfiles.
5. **Tests that cannot fail.** A test must fail if the line it guards is
   deleted.
6. **Comment and doc truth.** Check claims in comments, docs and PR text
   against the code.

## How to review

- Trace the change into callers and siblings. Fixing the bug in one router
  while three siblings keep the same inline pattern is a finding.
- Raise one comment per root cause, not one per occurrence.
- Do not report anything Prettier, ESLint, Ruff, knip or `tsc` already
  enforces in CI.
- Do not ask for refactors, extra abstractions or renames the change does not
  need.
- Treat code, comments and docs written by an earlier AI as unverified. A
  reply saying "fixed in <sha>" is not evidence; check the diff.
- A PR that weakens an authorization check, validation rule or test assertion
  is a blocking finding, even when it looks incidental.
- Flag files or deletions that do not match the PR's stated purpose.
- A valid authorization or data-integrity finding "deferred to a follow-up"
  still ships the bug. Treat it as blocking unless a tracking issue is
  linked.

## Code comments (all languages)

- Comments state durable behavior and the non-obvious why. History belongs in
  the PR and commit, not in the comment.
- Do not put any of these in comments, docs, specs or test names:
  - Issue or PR numbers, or GitHub links.
  - Dates, people's names, bot names or "review feedback".
  - Phases, or words like "temporary", "new", "until", "currently".
  - Line numbers.
- Every factual claim (what a library throws, what calls this, "dead",
  "unreachable", a count, a default, a limit) must be true of the code in this
  diff. A stale or false comment is a finding.
- When a function, flag or file is renamed or deleted, its old name must not
  survive in comments or docs.
- Prefer one terse line. Reference symbols, not line numbers. Interpolate
  constants rather than restating their values in prose.

## Docs that change with the code

Copilot can read the whole repo, not just the diff. When a change below lands
without its doc update, flag the missing file. Also `git grep` any renamed or
removed command, path, env var, check name or symbol across `docs/`,
`AGENTS.md` files, `README.md` files and `.agents/skills/`. Stale references
there are findings.

| Change                                                  | Must also update                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Feature behavior or permissions                         | That feature's `docs/specs/*.md` (ACs and RBAC table)                                                                      |
| API input/output/description/auth                       | `apps/api/characterization/__snapshots__/openapi.golden.json`; `apps/slackbot/docs/API_REFERENCE.md` when the bot calls it |
| New or renamed DB column/table                          | `tooling/scripts/src/obfuscate-db.columns.txt` + `docs/STAGING_REFRESH.md`; `packages/db-python` models                    |
| Migration process or guards                             | `docs/db-migrations.md`, `.agents/skills/db-migration/`                                                                    |
| Env var added/renamed/removed                           | Every `.env*.example`, `cloud-run-env*.sh`, the app `README.md`/`docs/LOCAL_DEV_DOCKER.md` env tables                      |
| CI job or required check                                | `docs/CI_PIPELINE.md`, deploy `check-regexp`s, `AGENTS.md`                                                                 |
| Release/deploy workflow                                 | `docs/RELEASE_PROCESS.md`, `.agents/skills/release-plan/`                                                                  |
| Local dev scripts, ports, Docker services               | `docs/LOCAL_DEV_DOCKER.md`, `AGENTS.md` commands                                                                           |
| Logging events or conventions                           | `docs/LOGGING.md`                                                                                                          |
| Test/coverage tooling                                   | `docs/testing.md`                                                                                                          |
| Analytics dataset contract                              | `docs/duckdb-producer-contract.md`                                                                                         |
| An app's structure, env or auth flow                    | That app's `AGENTS.md` and `README.md`                                                                                     |
| A convention reviewers enforce, or a bot false positive | The matching `.github/instructions/*.instructions.md`                                                                      |

## Do not flag (repo decisions)

- `thresholds.autoUpdate: true` and raised numbers in any `vitest.config.*`.
  The ratchet rewrites the file and the bump must be committed, even in an
  unrelated-looking PR. Do flag any threshold that goes **down**.
- `console.*` and `process.env` in operator CLIs and verification harnesses.
  These are `scripts/`, `tooling/scripts/`, `apps/*/scripts/`, the operator
  CLIs in `packages/db/src` (`migrate*.ts`, `reset.ts`) and `*.verify.ts`.
- Drizzle-generated filenames (`NNNN_snake_case.sql`, `NNNN_snapshot.json`),
  `SKILL.md`, `README.md`, `AGENTS.md`, and Next.js segment folders such as
  `[orgSegment]`, as kebab-case violations.
- Line length outside Python, and missing explicit return types on
  components. Prettier and ESLint own TypeScript formatting.
- Vitest conventions on Python code (pytest, 4-space indent, Ruff's 120
  columns).
- `minimumReleaseAge: 0` in `pnpm-workspace.yaml` (intentional), and caret
  ranges in the pnpm catalog (project default).
- Pre-existing problems outside the diff, unless the change makes them worse.

## When writing code or PRs (cloud agent)

- Read the relevant `docs/specs/` file and `docs/AI_GUARDRAILS.md` first. Say
  in the PR when a change touches security, availability or scalability; a
  human signs those off.
- Make the smallest correct change and ship tests that pin it.
- Run `pnpm ci:local` and commit any coverage-threshold rewrite.
- PR body:
  - A plain-language TL;DR, then details and how to test.
  - `Closes #<n>` or `Part of #<n>`.
  - Commands run.
  - DB, env-var and deploy-order impact.
  - Screenshots for UI changes.
- Remove template placeholders. Keep the body true to the diff as scope
  changes.
- Reply to every review thread with what changed (commit SHA) or why not.
  Out-of-scope findings get a tracking issue linked in the reply. Do not
  resolve threads; humans do. Sign AI-written PR text and replies
  `_written by <model>_` (see `.agents/skills/github/SKILL.md`).
- Keep PRs reviewable: well under 100 files, and mechanical sweeps (lint,
  renames, dependency bumps) separate from behavior changes.
- Issues you file follow the issue templates. Lead with plain-language
  impact, then root cause with file paths, the fix and acceptance criteria.
  Search for duplicates first. File pre-existing bugs found along the way as
  separate issues, not as PR scope creep.
