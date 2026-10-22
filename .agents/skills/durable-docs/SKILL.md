---
name: durable-docs
description: Rules for documentation that still makes sense in three months — inline comments and markdown that say what something does and why it protects or prevents, never change history, GitHub issue/PR links, or one-time instructions. Use whenever writing or editing code comments or any markdown in this repo (docs/, READMEs, specs, .agents/skills, app AGENTS.md), or whenever a PR touches comments or docs — even if durability is never mentioned. Audit mode, which rewrites existing files in bulk, runs only when the user explicitly asks to audit or sweep existing docs; a casual "clean up" or "make the docs less stale" means apply these rules to the text at hand, not run an audit.
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

These rules govern text you write or touch. There is no repo-wide migration:
loading this skill never implies rewriting existing files. Existing text
changes either when normal work already has you editing it, or in **audit
mode** below, which runs only on an explicit request.

## What durable text contains

- **What it does** — only where the code doesn't already say it plainly. A
  comment that restates `while (attempts < 3)` is noise: delete it rather than
  keep it.
- **Why, as a standing reason** — the constraint it protects against or the
  failure it prevents, in present tense. The durable part of a "why" is the
  general condition, never the event that revealed it.

  ```ts
  // Not durable — a history book. Meaningful only to people who remember June
  // and can find the issue: "Came out of the 6/12 Akamai outage, see issue
  // #<n>."
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
  now Y", dated entries, version tables, "temporary until PR #<n>". Git
  history and the release changelog already record what changed; a file that
  narrates its own edits forces every future reader to reconstruct history to
  understand the present.
- **GitHub issue/PR links or numbers** — `#<n>`, `…/pull/<n>`. Issues and PRs
  are edited, closed, and deleted; the reader may not even have permission to
  open them. The reference direction is fixed: **issues and PRs point at code,
  never code at issues.** If a fact from a discussion is worth keeping, put
  the fact itself in the file. Links to _external_ references (MDN, vendor
  docs, RFCs) are fine — those are references, not records.
- **Allusions** — "as discussed", "per @someone's request", "as agreed in the
  thread". Anything the reader can't resolve from the file alone gets cut.
- **One-time instructions** — run-once scripts, "on staging run X then Y"
  written for a single upcoming change, "delete after backfill". See below.

### Durable exceptions

Content that looks like the failures above can itself be a standing
constraint; cutting it silently changes what the file guarantees. These stay:

- **Dates the constraint depends on** — a deprecation deadline, an SLA
  window, an incident date an availability limit is measured from. The anchor
  is the "why"; keep it and cut only the narrative around it.
- **Forward-looking obligations** — rollout gates, phase and roadmap
  boundaries, exit criteria, "X must land before Y". They say what must be
  true before the next step, which is a standing why in future tense. Never
  delete one: if it names an issue or PR number, replace the number with the
  condition it stands for and keep the obligation itself.
- **Records** — merged ADRs and their `Date`/`Author(s)` headers are
  append-only (see audit step 5); rewriting one falsifies the record.

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
- **Instructional examples are not violations.** A phrase quoted inside a
  rule that bans it — this skill's own ban list included — illustrates the
  pattern; its numeric examples use `#<n>` placeholders, so neither this
  skill's examples nor any file's quoted rule text count as real references.
- Mechanical follow-ups (draft PRs, reply etiquette, attribution) belong to
  the [github](../github/SKILL.md) skill.

## Mode: periodic audit

Rewrites happen **in place on a clean branch** off the base chosen in step 2;
the person who asked creates the PR. Nothing is pushed and no issue is filed
without their say-so.

1. **Confirm scope** — which trees: `apps/`, `packages/`, `docs/`,
   `.agents/`, root-level `README.md`/`AGENTS.md`? Default to the paths they
   named; the whole repo only if they asked for it.
2. **Pick the base with them, from a clean tree.** The audit should land on
   the branch that will actually be reviewed and merged — default to their
   current branch, and branch from `origin/main` only when they say main. If
   `git status --porcelain` is non-empty, **stop and ask** how they want to
   proceed (commit, stash, or a separate worktree) — never disturb
   uncommitted work. Otherwise:

   ```bash
   git fetch origin && git switch -c chore/durable-docs-audit <base-branch>
   ```

3. **Find failures, then show the list before touching anything.** Read the
   files in scope; seed the search with the smell patterns below and add any
   you notice in passing. `git grep` searches every **tracked** file —
   Python, shell, YAML, JSON, and root-level docs included — so no source or
   doc format escapes the scan and untracked build output is never searched;
   the pathspecs exclude generated history (`CHANGELOG.md`), the lockfile,
   and `*.sql` migration history, all already out of scope. Matches are
   candidates, not verdicts — read the context before changing anything, and
   never rewrite a literal value (hex colors, in-repo anchor links, and
   other literals can match the `#` pattern). Present the findings as
   `file → line → why it fails` and rewrite only the files they confirm; the
   rest go to the summary as-is.

   ```bash
   git grep -nE 'github\.com/[^ )]+/(pull|issues)/' -- ':(exclude)*.sql' ':(exclude)CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   git grep -nE '(^|[^a-zA-Z0-9_])#[0-9]+\b' -- ':(exclude)*.sql' ':(exclude)CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   git grep -niE 'as discussed|per (review|request)|previously|used to be|as of (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|hotfix|for now|temporary|remove (this )?after|delete after' -- ':(exclude)*.sql' ':(exclude)CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   ```

   Narrow to the confirmed scope from step 1 by appending its paths (e.g.
   `… -- apps docs`), keeping the `:(exclude)` pathspecs. Also flag files
   whose names declare them one-offs (`*one-off*`, `*onetime*`, `fix-*`,
   `tmp-*`).

4. **Rewrite each finding** to present-tense what + standing why, or delete
   it outright when nothing durable is left — never when it is a
   forward-looking obligation or a date-anchored constraint (see **Durable
   exceptions**): restate those instead. Replace an issue/PR link with the
   fact it was standing in for — never with another link.
5. **Merged ADRs and `docs/specs/` are flag-only.**
   [`docs/adr/README.md`](../../../docs/adr/README.md) makes merged ADRs
   append-only records; rewriting one falsifies the record. Specs are the
   source of truth for what a feature does and who may do it (see
   [`AGENTS.md`](../../../AGENTS.md)), and a bulk rewrite cannot preserve
   that behavioral contract — list findings for both in the summary instead
   of editing. Spec phrasing gets fixed deliberately during normal feature
   work (writing mode, step 3). (New ADRs follow the rules from their first
   line.)
6. **Collect excised narrative** — anything you removed that someone still
   needs — into the draft PR body (or an issue, if they prefer). That is the
   durable home for it.
7. **Check the diff, then format and commit.** Re-read `git diff` hunk by
   hunk: every hunk that removes a why must show where its standing why went
   — replacement text, an explicit "pure narrative, nothing durable" reason,
   or it gets reverted. Then format only what you touched:
   `pnpm exec prettier --write <files>`, and **before committing** verify
   `git diff --stat` shows exactly the audit scope — once committed, that
   command is empty. Commit per `AGENTS.md` Conventional Commits with the
   scope of the files touched (e.g.
   `docs(repo): make docs and comments durable`, `docs(auth): …`);
   afterwards `git show --stat HEAD` should list the same files.
8. **Stop and hand over**: a summary table (file → finding → what you did),
   plus a drafted PR title and body (with the excised-narrative section from
   step 6). Push and open a **draft** PR only if they ask.

## What to leave out of this skill's work

- Spelling, tone, grammar, and doc structure — not what this is about.
- Dead _external_ links: outside-repo link rot is a different problem.
- Generated or vendored files: `CHANGELOG.md`, `.claude/skills/` (copied from
  `.agents/skills/`), `node_modules/`.
- This skill's own `SKILL.md` during an audit — its `#<n>` placeholders and
  quoted ban-list phrases are illustrations, and the audit greps will find
  them.
- Merged ADRs, and the `Date`/`Author(s)` header of any ADR — records keep
  their identity.
- Deleting `packages/db/drizzle/*.sql` migration history — never.
- Anything outside the scope they confirmed in step 1.
