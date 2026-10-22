---
name: durable-docs
description: Rules for documentation that still makes sense in three months — inline comments and markdown that say what something does and why it protects or prevents, never change history, GitHub issue/PR links, or one-time instructions. Use whenever writing or editing code comments or any markdown in this repo (docs/, READMEs, specs, .agents/skills, app AGENTS.md), whenever a PR touches comments or docs, or when asked to audit, clean up, or "make the docs less stale" — even if durability is never mentioned.
---

# Durable docs and comments

A committed file outlives the change that motivated it. Months later the PR is
merged and forgotten, the incident is a blur, and the only reader — often an
AI — has none of that context. Documentation is durable when it still explains
itself after everything outside the file is deleted.

**The test every comment and doc must pass:** a reader with no memory of the
change, no PR, no issue, no Slack thread — does the text still say (1) what
the thing does, where the code doesn't make that obvious, and (2) why it is
that way: what it protects or prevents? If any meaning lives outside the file,
or stops being true as the system changes, the text isn't durable.

Three modes: **writing** new code, **reviewing** a PR, **auditing** what
exists. The rules are the same in all three; only the last section differs.

## What durable text contains

- **What it does** — only where the code doesn't already say it plainly. A
  comment that restates `while (attempts < 3)` is noise: delete it rather than
  keep it.
- **Why, as a standing reason** — the constraint it protects against or the
  failure it prevents, in present tense. The durable part of a "why" is the
  general condition, never the event that revealed it.

  ```ts
  // Not durable — a history book. Meaningful only to people who remember June
  // and can find #1482: "Came out of the 6/12 Akamai outage, see #1482."
  const retries = 2;

  // Durable — what + standing why, complete in itself: "Two attempts max: the
  // upstream abuse filter bans the shared key for an hour after ~3 failures in
  // a minute, so retrying more costs more than failing."
  const retries = 2;
  ```

- **Names, not pointers** — cite a function, table, config key, or file path:
  symbols that live in the repo and resolve by reading. Markdown links to
  other files **in this repo** are durable too (use relative paths).

## Never in a committed file

Each of these is a form of the same failure: meaning that exists only outside
the file, or meaning that won't be true later.

- **Change narrative** — "Added in May…", "Updated to handle…", "Previously X
  now Y", dated entries, version tables, "temporary until PR #123". Git
  history and the release changelog already record what changed; a file that
  narrates its own edits forces every future reader to reconstruct history to
  understand the present.
- **GitHub issue/PR links or numbers** — `#123`, `…/pull/891`. Issues and PRs
  are edited, closed, and deleted; the reader may not even have permission to
  open them. The reference direction is fixed: **issues and PRs point at code,
  never code at issues.** If a fact from a discussion is worth keeping, put
  the fact itself in the file. Links to _external_ references (MDN, vendor
  docs, RFCs) are fine — those are references, not records.
- **Allusions** — "as discussed", "per @someone's request", "as agreed in the
  thread". Anything the reader can't resolve from the file alone gets cut.
- **One-time instructions** — run-once scripts, "on staging run X then Y"
  written for a single upcoming change, "delete after backfill". See below.

## Transient content: PR and issue bodies, not the repo

A committed file is for what remains true or remains needed. Everything else
has a body-shaped home:

| Content                                               | Home                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| What this particular change did and why               | PR body                                                                  |
| One-time data fix / backfill script, run-once runbook | PR body that performs it; an issue body if no PR will carry it           |
| We tried X and it failed — worth remembering          | An **issue that quotes the file path and symbol**, then closed as record |
| Schema migration `.sql`                               | **Stays** — versioned schema history in `packages/db/drizzle/`           |
| How to run migrations, ever                           | `docs/db-migrations.md` (standing process)                               |

If you catch yourself wanting to record history in a comment ("we should note
that we tried this and it broke"), that is the signal to write the issue or PR
body instead — after it exists, the committed file still says only what is
true today. Filing issues: the repo [github](../github/SKILL.md) skill.

## Mode: writing new code or docs

1. Write the code first; let it speak. Comment only the non-obvious what and
   the standing why — what a reader would spend minutes of reading, or one
   wrong change, rediscovering.
2. Before committing, run the test at the top on every comment and doc line
   you added. Cut what fails; move the memory to a PR/issue body.
3. Docs in `docs/` describe how the system **is**, not what just changed.
   Specs remain the source of truth for what a feature does and how it's
   verified (see [`AGENTS.md`](../../../AGENTS.md)); this skill governs how those
   words are phrased.
4. Writing an ADR: same rules, on top of the prescribed sections in
   [`docs/adr/`](../../../docs/adr/README.md) — no issue links, no dated
   narrative inside Context/Decision.

## Mode: PR review

When a PR adds or edits comments or markdown, review the text like code:

- Flag every item under **Never in a committed file** and every text that
  fails the test — each with a one-line reason and a rewrite you've actually
  written. A suggested rewrite beats a rule citation; the author should be
  able to paste it.
- Mechanical follow-ups (draft PRs, reply etiquette, attribution) belong to
  the [github](../github/SKILL.md) skill.

## Mode: periodic audit

Rewrites happen **in place on a clean branch from `main`**; the person who
asked creates the PR. Nothing is pushed and no issue is filed without their
say-so.

1. **Confirm scope** — which trees: `apps/`, `packages/`, `docs/`,
   `.agents/`? Default to the paths they named; the whole repo only if they
   asked for it.
2. **Branch from a clean tree.** If `git status --porcelain` is non-empty,
   **stop and ask** how they want to proceed (commit, stash, or a separate
   worktree) — never disturb uncommitted work. Otherwise:

   ```bash
   git fetch origin main && git switch -c chore/durable-docs-audit origin/main
   ```

3. **Find failures.** Read the files in scope; seed the search with the smell
   patterns below and add any you notice in passing. Matches are candidates,
   not verdicts — read the context before changing anything.

   ```bash
   grep -rn -E 'github\.com/[^ )]+/(pull|issues)/' --include='*.ts' --include='*.tsx' --include='*.md'
   grep -rn -E '(^|[^a-zA-Z0-9_])#[0-9]{3,5}' apps packages docs .agents --include='*.ts' --include='*.md'
   grep -rni -E 'as discussed|per (review|request)|previously|used to be|as of (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|hotfix|for now|temporary|remove (this )?after|delete after' --include='*.ts' --include='*.tsx' --include='*.md'
   ```

   Also flag files whose names declare them one-offs (`*one-off*`,
   `*onetime*`, `fix-*`, `tmp-*`).

4. **Rewrite each finding** to present-tense what + standing why, or delete
   it outright when nothing durable is left. Replace an issue/PR link with the
   fact it was standing in for — never with another link.
5. **Merged ADRs are exempt.** [`docs/adr/README.md`](../../../docs/adr/README.md)
   makes them append-only records; rewriting one falsifies the record. List
   their findings in the summary instead of editing. (New ADRs follow the
   rules from their first line.)
6. **Collect excised narrative** — anything you removed that someone still
   needs — into the draft PR body (or an issue, if they prefer). That is the
   durable home for it.
7. **Format, then commit.** Format only what you touched:
   `pnpm exec prettier --write <files>`. Commit per `AGENTS.md` Conventional
   Commits with the scope of the files touched (e.g.
   `docs(repo): make docs and comments durable`, `docs(auth): …`). Verify
   `git diff --stat` shows exactly the audit scope.
8. **Stop and hand over**: a summary table (file → finding → what you did),
   plus a drafted PR title and body (with the excised-narrative section from
   step 6). Push and open a **draft** PR only if they ask.

## What to leave out of this skill's work

- Spelling, tone, grammar, and doc structure — not what this is about.
- Dead _external_ links: outside-repo link rot is a different problem.
- Generated or vendored files: `CHANGELOG.md`, `.claude/skills/` (copied from
  `.agents/skills/`), `node_modules/`.
- Merged ADRs, and the `Date`/`Author(s)` header of any ADR — records keep
  their identity.
- Deleting `packages/db/drizzle/*.sql` migration history — never.
- Anything outside the scope they confirmed in step 1.
