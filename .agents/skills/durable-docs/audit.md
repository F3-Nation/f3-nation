# Durable docs audit

This file carries audit mode of the [durable-docs skill](SKILL.md): the same
rules, applied in bulk to files that already exist. Read
[`SKILL.md`](SKILL.md) first — nothing here relaxes **Never in a committed
file**, its exceptions, the drift rules, or the test at the top. An audit runs only when someone
explicitly asks to audit or sweep; a casual "clean up" means apply the rules to
the text at hand. Files that are out of scope entirely (generated changelogs,
this skill's own files, the lockfile, migration history) are listed under
[What to leave out of this skill's work](SKILL.md#what-to-leave-out-of-this-skills-work).

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
   the pathspecs exclude this skill's own directory, generated history (every
   `CHANGELOG.md`), the lockfile, and the `packages/db/drizzle/` migration
   history — all already out of scope; every other tracked SQL file is
   searched. Matches are candidates, not verdicts — read the context before
   changing anything, and never rewrite a literal value (hex colors, in-repo
   anchor links, and other literals can match the `#` pattern). Present the
   findings as `file → line → why it fails` and rewrite only the files they
   confirm; the rest go to the summary as-is.

   ```bash
   git grep -nE 'github\.com/[^ )]+/(pull|issues)/' -- ':(exclude).agents/skills/durable-docs/' ':(exclude)packages/db/drizzle/*.sql' ':(exclude,glob)**/CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   git grep -nE '(^|[^a-zA-Z0-9_])#[0-9]+\b' -- ':(exclude).agents/skills/durable-docs/' ':(exclude)packages/db/drizzle/*.sql' ':(exclude,glob)**/CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   git grep -niE 'as discussed|per (review|request)|previously|used to be|as of (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|hotfix|for now|temporary|remove (this )?after|delete after' -- ':(exclude).agents/skills/durable-docs/' ':(exclude)packages/db/drizzle/*.sql' ':(exclude,glob)**/CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   ```

   Narrow to the confirmed scope from step 1 by appending its paths (e.g.
   `… -- apps docs`), keeping the `:(exclude)` pathspecs. Also flag files
   whose names declare them one-offs (`*one-off*`, `*onetime*`, `fix-*`,
   `tmp-*`).

   Most drift has no fixed wording, so search alone won't find it: read each
   comment and doc in scope against
   [Drift](SKILL.md#drift-references-that-go-stale-silently). The phrasings
   below are a starting point for the patterns that do repeat — positions,
   comparisons, and caller lists. They match a lot of legitimate prose, so
   treat every hit as a candidate.

   ```bash
   git grep -niE '(on|at|see) line [0-9]+|see (above|below)|(same|works|behaves) (as|like)|mirrors|(only )?called (from|by)|used by' -- ':(exclude).agents/skills/durable-docs/' ':(exclude)packages/db/drizzle/*.sql' ':(exclude,glob)**/CHANGELOG.md' ':(exclude)pnpm-lock.yaml'
   ```

4. **Rewrite each finding** to present-tense what + standing why — for a
   drifting reference, the rule or reason it stood in for — or delete
   it outright when nothing durable is left — never when it is a constraint
   in force now or a date-anchored constraint (see
   [Exceptions: content that stays](SKILL.md#exceptions-content-that-stays)):
   restate those instead, and leave plans (no present constraint) to an
   issue. Replace an issue/PR link with the fact it was standing in for —
   never with another link.
5. **Merged ADRs and `docs/specs/` are flag-only.**
   [`docs/adr/README.md`](../../../docs/adr/README.md) makes merged ADRs
   append-only records; rewriting one falsifies the record. Specs are the
   source of truth for what a feature does and who may do it (see
   [`AGENTS.md`](../../../AGENTS.md)), and a bulk rewrite cannot preserve
   that behavioral contract — list findings for both in the summary instead
   of editing. Spec phrasing gets fixed deliberately during normal feature
   work, under
   [writing mode in `SKILL.md`](SKILL.md#mode-writing-new-code-or-docs). (New ADRs follow
   the rules from their first line.)
6. **Collect excised narrative** — anything you removed that someone still
   needs — into the draft PR body (or an issue, if they prefer). That is the
   durable home for it.
7. **Check the diff, validate, then format and commit.** Re-read `git diff`
   hunk by hunk: every hunk that removes a why must show where its standing
   why went — replacement text, an explicit "pure narrative, nothing durable"
   reason, or it gets reverted. Then run the validation `AGENTS.md` requires
   of every change — `pnpm lint:fix`, `pnpm format:fix`, `pnpm typecheck` —
   which a Markdown-only audit runs like any other, and format what you
   touched with `pnpm exec prettier --write <files>`. **Before committing**,
   verify `git diff --stat` shows exactly the audit scope — once committed,
   that command is empty. Commit per `AGENTS.md` Conventional Commits with the
   scope of the files touched (e.g.
   `docs(repo): make docs and comments durable`, `docs(auth): …`);
   afterwards `git show --stat HEAD` should list the same files.
8. **Stop and hand over**: a summary table (file → finding → what you did),
   plus a drafted PR title and body (with the excised-narrative section from
   step 6). Push and open a **draft** PR only if they ask.
