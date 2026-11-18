---
name: issue-triage
description: 'Use right after creating any GitHub issue in this repo (gh issue create, an issue filed from an audit or review, a bug found while coding), even when the user never mentions triage, and whenever asked to triage issues ("triage #123", "triage the backlog", "which issues need Priority?", "which issues are good first issues?"). Proposes the issue''s Type, Priority, Effort and App, and whether it should get the `good first issue` label, with a one-line reason each, and writes them only once approved.'
compatibility: Any agent with bash, jq and an authenticated gh. Writing needs the repo scope; reading the organization's fields needs read:org.
---

# Issue triage

Every issue in this repo should have four values: **Type** (the issue's own
type) and three organization issue fields, **Priority**, **Effort** and
**App**. This skill decides them from the issue's content and sets them with
[`scripts/issue-fields.sh`](scripts/issue-fields.sh). It also recommends the
`good first issue` label for issues a newcomer could pick up (see
[Good first issue](#good-first-issue)).

The allowed values are set at the organization level and can change. Never
type them from memory: run `issue-fields.sh options` first and choose only
from what it prints. The script rejects any other name and lists the valid
ones. The rules under "Deciding each value" name the values as they are set
now; when an organization value is renamed, added or removed, update those
rules in the same change. If `options` prints a value the rules don't
describe, or lacks one they do, tell the user the rules are out of date and
ask before choosing.

## Rules for every run

- **Fill gaps; don't overwrite.** Propose only the values an issue is missing.
  If an existing value looks wrong, say so in the proposal, and change it only
  when the user agrees. Right before writing, re-read the issues with `get`
  and drop any proposed value the issue has gained since, unless the user
  approved replacing it.
- **Propose before writing.** Show each issue's values with a one-line reason
  each, and write only after the user approves. Exception: the user asked you
  to set the values outright. Filing an issue is not that request; after
  filing, propose the values in the same reply.
- **Priority is the maintainers' call.** Your Priority is a suggestion they
  can change. When the issue doesn't say who is affected or how badly, give
  your best guess and mark it _unsure_ rather than leaving it empty.
- Read the whole issue before deciding: body, labels, parent issue and
  sub-issue count. The title alone misleads. `get` and `untriaged` cut long
  bodies and end them with `[truncated]`; read the full text with
  `gh issue view <n> --json body` before deciding.

## Commands

Run from the repo root. `GH_REPO=owner/name` targets another repository.
Keep working files in a private temp directory (`mktemp -d`), shown as
`<scratch>`, never in the repo.

```bash
S=.agents/skills/issue-triage/scripts/issue-fields.sh
bash $S options                 # allowed Types and field values
bash $S get 123 456             # one JSON object per issue, current values + body
bash $S untriaged > <scratch>/untriaged.jsonl  # open issues missing any of the four
bash $S set 123 --type Bug --priority Medium --effort Low --app Map
bash $S apply <scratch>/proposals.tsv  # bulk write; checks every row before writing any
gh api graphql -F owner='{owner}' -F name='{repo}' -F n=123 -f query='query($owner:String!,$name:String!,$n:Int!){ repository(owner:$owner,name:$name){ issue(number:$n){ assignees(first:5){ nodes{ login } } closedByPullRequestsReferences(first:5){ nodes{ number state } } blockedBy(first:10){ nodes{ number state } } subIssuesSummary{ total completed } } } }' --jq '.data.repository.issue'  # free to take?
gh issue edit 123 --add-label "good first issue"
gh issue edit 123 --remove-label "good first issue"
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

Decide Type by these definitions, which are stricter than the short
descriptions set on the organization's issue types:

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

- An app under `apps/` maps to the `options` entry of the same name
  (`apps/region-pages` is Region Pages). If `options` has no entry for that
  app, say so in the proposal and leave App empty rather than pick a neighbor.
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

### Good first issue

The `good first issue` label points newcomers to work they can finish without
knowing the codebase or holding production access. A wrong label costs a
volunteer's first attempt, so recommend it only when every one of these holds:

- **Effort is Low** (the issue's value, or the one you are proposing).
- **Type is Bug, Story or Task**, never Epic or Discussion.
- **The body says what to change and what done looks like**: the files or
  screen involved, and the expected result. A newcomer could start without
  asking a maintainer first. No open design question or "investigate why".
- **No sensitive area**: not auth, sign-in, permissions or API keys; not a
  security fix; not a schema change or migration; not deploy, Cloud Run,
  secrets or release tooling.
- **No outside access**: reproducing and testing it works in the local Docker
  setup, without Staging or Production data, Slack workspaces or cloud
  consoles.
- **Free to take**: no assignee, no open PR that closes it, and no unfinished
  sub-issue or blocking issue.

Priority doesn't matter: a Low-priority polish item can be a fine first issue.
Recommend only adding the label. If an issue already has it but fails a
condition above, say which one in the proposal, and remove the label only
when the user agrees.

## One issue

1. `bash $S options`, then `bash $S get <n>`, and, for a possible
   `good first issue`, the free-to-take query above.
2. Decide each missing value using "Deciding each value", and show the user a
   short table: value, then a one-line reason. Add a `good first issue` row
   when the issue qualifies, or when it carries the label but doesn't.
3. On approval (or straight away if asked to set them), run `bash $S set`
   with the approved values, skipping it when no Type or field value was
   approved (it exits with `nothing to set`). Only after `set` succeeds,
   change an approved label with `gh issue edit`. Then run `bash $S get <n>`
   to confirm.

## The backlog

1. `bash $S options`, then `bash $S untriaged > <scratch>/untriaged.jsonl`.
   `untriaged` lists issues missing any of the four values; when the user asks
   about one field, keep only the issues missing it, e.g.
   `jq -c 'select(.priority == null)' <scratch>/untriaged.jsonl > <scratch>/todo.jsonl`
   (for App, `select(.app == [])`), and work from that file.
   When the user asks only which issues are good first issues, work from
   every open issue instead:
   `gh issue list --state open --limit 2000 --json number --jq '.[].number'`,
   then `get` those numbers.
2. For more than about 20 issues, split the file and give each part to a
   subagent along with this file; each returns TSV rows. Tell them to leave
   cells empty for values the issue already has, and to run the
   free-to-take query for each possible `good first issue`. In the `gfi`
   column, put `yes` only for an issue without the label that meets every
   [Good first issue](#good-first-issue) condition, and `remove` for an issue
   that has the label but fails one, naming the failed condition in `reason`.
3. Combine the rows into `<scratch>/proposals.tsv` with the header
   `# number	type	priority	effort	app	gfi	title	reason` and show it to
   the user as a table, grouped by App. `apply` ignores `gfi` and the columns
   after it.
4. Apply the approved rows with `bash $S apply`, leaving out rows whose four
   values are all empty (a label-only row is an error there); skip `apply`
   when no rows remain, since it exits with `no rows in` on an empty file.
   Once it succeeds, re-run the free-to-take query for each approved `yes`
   issue, skip and report any that is no longer free, and add the label to
   the rest with `gh issue edit --add-label`. Remove it from each approved
   `remove` issue with `gh issue edit --remove-label`.
5. Then confirm: for field rows, re-run `untriaged` with the same filter as
   step 1 and check that only the issues the user held back remain; for
   labels, run `bash $S get` on the approved `gfi` numbers and check that
   each one's `labels` includes `good first issue` (or no longer does, for
   `remove`).
