---
name: issue-triage
description: Set an issue's Type and its Priority, Effort and App fields — for one issue ("triage #123", "set the fields on this issue"), right after filing an issue, or for every open issue still missing them ("triage the backlog", "which issues need Priority?"). Proposes values with a one-line reason each and writes them only once approved.
compatibility: Any agent with bash, jq and an authenticated gh. Writing needs the repo scope; reading the organization's fields needs read:org.
---

# Issue triage

Every issue in this repo carries four values that drive the project board:
**Type** (the issue's own type) and three organization issue fields,
**Priority**, **Effort** and **App**. This skill decides them from the issue's
content and sets them with [`scripts/issue-fields.sh`](scripts/issue-fields.sh).

The allowed values are set at the organization level and can change. Never
type them from memory or from this file: run `issue-fields.sh options` first
and choose only from what it prints. The script rejects any other name and
lists the valid ones.

## Rules for every run

- **Fill gaps; don't overwrite.** Propose only the values an issue is missing.
  If an existing value looks wrong, say so in the proposal, and change it only
  when the user agrees.
- **Propose before writing.** Show each issue's values with a one-line reason
  each, and write only after the user approves. Exception: the user asked you
  to set the values outright (for example, on an issue you just filed for them).
- **Priority is the maintainers' call.** Your Priority is a suggestion they
  can change. When the issue doesn't say who is affected or how badly, give
  your best guess and mark it _unsure_ rather than leaving it empty.
- Read the whole issue before deciding: body, labels, parent issue and
  sub-issue count. The title alone misleads. `get` and `untriaged` cut long
  bodies and end them with `[truncated]`; read the full text with
  `gh issue view <n> --json body` before deciding.

## Commands

Run from the repo root. `GH_REPO=owner/name` targets another repository.

```bash
S=.agents/skills/issue-triage/scripts/issue-fields.sh
bash $S options                 # allowed Types and field values
bash $S get 123 456             # one JSON object per issue, current values + body
bash $S untriaged > <scratch>/untriaged.jsonl  # open issues missing any of the four
bash $S set 123 --type Bug --priority Medium --effort Low --app "Map,API"
bash $S apply proposals.tsv     # bulk write; checks every row before writing any
```

`apply` reads tab-separated rows of `number`, `type`, `priority`, `effort`,
`app` (comma-separated). An empty cell leaves that value unchanged, but a row
with every value empty is an error; drop such rows before applying. An App
value replaces the issue's whole App list, so list every app it should keep.
Lines starting with `#` are skipped, and any further columns (a reason, a
title) are ignored, so the reviewed table can be applied as is.

`apply` checks every row's values and looks up every issue before writing,
so a bad value or a missing issue writes nothing. It prints `setting #N`
before each issue and `set #N` after; if a write fails partway, the issues
already printed as `set` keep their new values, and the one named by the last
`setting` may have its Type changed. Check that issue with `get`, then
re-apply only the rows not yet set.

## Deciding each value

### Type

Use the organization's descriptions, which `options` doesn't print:

- **Bug** — something that already exists behaves wrongly: an error, wrong
  data, a broken page, a failing check.
- **Story** — new or changed behavior a user sees (a PAX, a region admin, a
  site visitor).
- **Task** — work no user sees: refactors, CI, tests, docs, dependency and
  infrastructure changes, security hardening with no visible change.
- **Epic** — a large, cohesive effort whose sub-issues together deliver one
  outcome. Sub-issues, or a plan to split into them, are evidence, not the
  test: a small parent is a Bug, Story or Task, and a list of related problems
  is not an Epic.
- **Discussion** — a proposal or open question ("consider…", "should we…")
  whose next step is a decision, not code. An issue that already says what to
  build is a Bug, Story or Task even if details are open.

### App

Choose **one** app: the one the issue is about — where users see the problem
or feature, or where most of the change lands. `options` lists every app in
the organization, including apps in other repositories.

- An app under `apps/` maps to the option of the same name (`apps/region-pages`
  is Region Pages).
- Schema, migrations and database infrastructure (`packages/db`, Cloud SQL)
  are **Database**.
- Shared packages, tooling, CI, scripts, repo config and work spread across
  most apps are **Monorepo**. That includes creating a shared package or
  moving apps' code into one, even though the apps change too and even when
  the issue carries an app label.
- Supporting changes don't add an app: a map feature that needs a new API
  query is Map, and an API change that needs a column is API. Add a second
  app only when the issue is equally about both, such as an admin page and
  the API permission rule it exposes.

Strong hints: an `app: …` label, the first scope in a Conventional Commit
title (`fix(admin): …`), file paths in the body and the issue form's
"Affected app" answer.

### Priority

How much it matters that this gets done soon, judged by who is affected and
how badly:

- **Urgent** — drop other work: production is down or broken for most users,
  data is being lost, or a security hole is being exploited. Very rare.
- **High** — a security weakness (data visible to the wrong people, secrets
  stored or logged in the clear), a core flow broken with no workaround
  (sign-in, sign-out, saving data), work that blocks a release or other
  planned work, or a cost or reliability risk in production.
- **Medium** — a user-visible bug with a workaround or limited reach, a
  feature users have asked for, flaky tests, or debt that slows regular work.
- **Low** — polish, cleanup and refactors with no current pain, rare edge
  cases, and proposals not yet planned.

Most issues are Medium or Low. Reserve High for issues where waiting has a
real cost. Judge a sub-issue on its own: it is higher than its parent only
when it blocks the parent's outcome, and lower when it is optional polish.

### Effort

The size of the whole issue for someone who knows the codebase, including any
sub-issues:

- **Low** — one PR in one area with a clear approach; about a day.
- **Medium** — changes across layers (UI, API and database), a migration,
  some investigation or design, or a few PRs; days to about a week.
- **High** — weeks of work: many PRs or sub-issues, several apps, an
  infrastructure move, or open design questions.

Most issues are Low or Medium. Judge the work the issue describes, not the
worst case: a repo-wide sweep of a known pattern is still Low or Medium when
each change is mechanical. An Epic's Effort covers all its sub-issues.

## One issue

1. `bash $S options`, then `bash $S get <n>`.
2. Decide each missing value using the rules above, and show the user a short
   table: value, then a one-line reason.
3. On approval (or straight away if asked to set them), run `bash $S set`
   with only the missing values, then `bash $S get <n>` to confirm.

## The backlog

1. `bash $S options`, then `bash $S untriaged > <scratch>/untriaged.jsonl`.
2. For more than about 20 issues, split the file and give each part to a
   subagent along with this file; each returns TSV rows. Tell them to leave
   cells empty for values the issue already has.
3. Combine the rows into one file with the header
   `# number	type	priority	effort	app	title	reason` and show it to the user
   as a table, grouped by App.
4. Apply the rows the user approves with `bash $S apply`, and re-run
   `untriaged` to confirm that only the issues they held back remain.
