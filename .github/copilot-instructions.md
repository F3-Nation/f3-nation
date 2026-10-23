# Copilot instructions

`AGENTS.md` is the canonical source for repo conventions. This file adds
review priorities that apply everywhere. Path-specific rules live in
`.github/instructions/*.instructions.md`.

## What to look for first

The defects that reached `main` were mostly logic and authorization mistakes,
not style. Review in this order:

1. **Authorization and data exposure.** A handler that takes an id checks the
   caller against the org that owns the fetched row and any target org.
   Anonymous paths never return private, inactive or personal data.
2. **Silent failure.** A `catch` that swallows the error, a script that exits
   0 on failure, a gate that passes after checking nothing, a fallback that
   hides an outage.
3. **Atomicity.** Read-then-write races, related writes outside one
   transaction, one-time flags set before the side effect succeeds.
4. **Cross-boundary breakage.** Every caller of a changed contract: the Slack
   bot's Python API client, map/admin/me hooks, the OpenAPI golden, deploy
   workflows, Dockerfiles.
5. **Tests that cannot fail.** A test must fail if the line it guards is
   deleted.
6. **Comment and doc truth.** Claims in comments, docs and PR text match the
   code.

## How to review

- Trace the change into callers and siblings. Fixing one router while three
  siblings keep the same pattern is a finding.
- One comment per root cause, not per occurrence.
- Skip anything Prettier, ESLint, Ruff, knip or `tsc` already enforces in CI.
- Do not ask for refactors, abstractions or renames the change does not need.
- Treat code, comments and docs written by an earlier AI as unverified. "Fixed
  in <sha>" is not evidence; check the diff.
- Weakening an authorization check, validation rule or test assertion is
  blocking, even when it looks incidental.
- Flag files or deletions that do not match the PR's stated purpose.
- A valid authorization or data-integrity finding "deferred to a follow-up"
  is blocking unless a tracking issue is linked.

## Do not flag

- `console.*` and direct `process.env` in the operator CLIs and verification
  harnesses that `AGENTS.md` § Logging lists.
- Drizzle-generated filenames (`NNNN_snake_case.sql`, `NNNN_snapshot.json`),
  Next.js segment folders (`[orgSegment]`), and `SKILL.md`, `README.md`,
  `AGENTS.md` or the uppercase `docs/*.md` names, as kebab-case violations.
- Line length outside Python, and missing explicit return types on
  components.
- Pre-existing problems the change does not touch or worsen.

## Code comments (all languages)

- State durable behavior and the non-obvious why, tersely. History belongs in
  the PR and commit.
- No issue or PR numbers, GitHub links, dates, people's or bot names,
  "review feedback", phases, line numbers, or words like "temporary", "new",
  "until", "currently". This covers comments, docs, specs and test names.
  Generated `CHANGELOG.md` is exempt.
- Every factual claim (what a library throws, what calls this, "dead",
  "unreachable", a count, default or limit) must be true of the code in this
  diff. A stale or false comment is a finding.
- A renamed or deleted function, flag or file leaves no old name in comments
  or docs.
- Reference symbols, not line numbers. In strings and descriptions,
  interpolate constants instead of restating their values.

## Docs that change with the code

When a change below lands without its doc update, flag the missing file. Also
`git grep` any renamed or removed command, path, env var, check name or symbol
across `docs/`, `AGENTS.md` files, `README.md` files and `.agents/skills/`.
Stale references are findings.

| Change                                                  | Must also update                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature behavior or permissions                         | That feature's `docs/specs/*.md` (ACs and RBAC table)                                                                                                                                      |
| API input/output/description/auth                       | `apps/api/characterization/__snapshots__/openapi.golden.json`; `apps/slackbot/docs/API_REFERENCE.md` when the bot calls it                                                                 |
| New or renamed DB column/table                          | `tooling/scripts/src/obfuscate-db.columns.txt` (a line per column), its classification in `obfuscate-db.ts` and `docs/STAGING_REFRESH.md`; `packages/db-python` models when mirrored there |
| Migration process or guards                             | `docs/db-migrations.md`, `.agents/skills/db-migration/`                                                                                                                                    |
| Env var added/renamed/removed                           | Every `.env*.example`, `cloud-run-env*.sh`, the app `README.md`/`docs/LOCAL_DEV_DOCKER.md` env tables                                                                                      |
| CI job or required check                                | `docs/CI_PIPELINE.md`, deploy `check-regexp`s, `AGENTS.md`                                                                                                                                 |
| Release/deploy workflow                                 | `docs/RELEASE_PROCESS.md`, `.agents/skills/release-plan/`                                                                                                                                  |
| Local dev scripts, ports, Docker                        | `docs/LOCAL_DEV_DOCKER.md`, `AGENTS.md` commands                                                                                                                                           |
| Logging events or conventions                           | `docs/LOGGING.md`                                                                                                                                                                          |
| Test/coverage tooling                                   | `docs/testing.md`                                                                                                                                                                          |
| Analytics dataset contract                              | `docs/duckdb-producer-contract.md`                                                                                                                                                         |
| An app's structure, env or auth flow                    | That app's `AGENTS.md` and `README.md`                                                                                                                                                     |
| A convention reviewers enforce, or a bot false positive | The matching `.github/instructions/*.instructions.md`                                                                                                                                      |

## When writing code or PRs (cloud agent)

- Read the relevant `docs/specs/` file and `docs/AI_GUARDRAILS.md` first. Say
  in the PR when a change touches security, availability or scalability; a
  human signs those off.
- Make the smallest correct change and ship tests that pin it.
- Run `pnpm ci:local` and commit any coverage-threshold rewrite.
- PR body: a plain-language TL;DR, details, how to test, `Closes #<n>` or
  `Part of #<n>`, commands run, DB/env-var/deploy-order impact, and
  screenshots for UI changes. Remove template placeholders and keep the body
  true to the diff as scope changes.
- Reply to every review thread with what changed (commit SHA) or why not.
  Out-of-scope findings get a tracking issue linked in the reply. Do not
  resolve threads; humans do. Sign AI-written PR text and replies
  `_written by <model>_` (see `.agents/skills/github/SKILL.md`).
- Keep PRs well under 100 files, with mechanical sweeps (lint, renames,
  dependency bumps) separate from behavior changes.
- File pre-existing bugs found along the way as separate issues, not PR scope
  creep. Search for duplicates first and follow the issue templates; lead
  with plain-language impact, then root cause with file paths, the fix and
  acceptance criteria.
