---
name: release-plan
description: Draft and file the GitHub issue that walks the release team through the steps after a release-please PR has merged and deployed to Staging — database migration, test plan, soak, and Production — with who does what, stop rules, and monitoring links. Use when someone asks for a "release plan".
---

# Release plan issue

Produces one GitHub issue that the release team works through, top to bottom,
after a release has merged. It is a **checklist, not a report**. The reference
for the right amount of detail is
[F3-Nation/f3-nation#1068](https://github.com/F3-Nation/f3-nation/issues/1068).
It predates the post-merge flow, so ignore its merge and deploy steps. Never
write more than that; shorter is better.

The target is always the **most recently merged** `chore: release main` PR.
Assume it has already been deployed to Staging successfully; do not plan the
merge or the Staging deploy. An open release PR is only a running changelog:
nothing is deployed until it merges, so never plan from one.

The Staging test plan is a separate issue made by the
[`staging-test-plan`](../staging-test-plan/SKILL.md) skill. Do not put test
steps in this issue.

## Inputs

Ask for anything missing before starting:

1. **Environment** — `Staging` (default) or `Production`.
2. **Release PR number** — optional, only to cross-check against the PR the
   skill finds.

## Steps

1. **Pick the target PR and confirm it with the user before doing anything
   else.** Find the most recently merged release PR:

   ```bash
   TZ="<IANA zone>" gh pr list --state merged --base main \
     --author app/f3-nation-release-please \
     --search "chore: release main in:title" --limit 100 \
     --json number,title,mergedAt \
     --jq 'sort_by(.mergedAt) | last | "#\(.number) merged \(.mergedAt | fromdateiso8601 | strflocaltime("%a %b %-d, %-I:%M %p %Z"))"'
   ```

   Use the user's timezone: ask for it (an IANA name such as
   `America/Chicago`) if you don't already know it, and set `TZ` to it in the
   command. Tell the user the PR number and merge time as the command prints
   it, never UTC, and ask them to confirm. If
   they gave a number that is not this PR, say so and ask which one they
   mean; do not silently follow either. If the PR they name is open or was
   closed without merging, stop and explain that only a merged release can be
   planned. Do not read the changelog until the user confirms.

2. **Read the release PR.**

   ```bash
   gh pr view <PR> --json title,body,state,mergedAt,mergeCommit --jq '{title,state,mergedAt,mergeCommit,body}'
   ```

   Stop unless `state` is `MERGED`. Record `mergeCommit.oid` as
   `{{RELEASE_SHA}}`. The body is the changelog: one `<details>` block per
   app, listing the merged PRs and issues. Note which apps are releasing.
   Ignore the version numbers — they never go in the issue.

   A merged PR does not prove every Production deploy, migration, or test
   finished. Leave those steps unchecked.

3. **Find new database migrations.** The previous release is the last
   `chore: release main` commit before this one. Stop if any command fails or
   no previous release is found.

   ```bash
   (
     set -e
     git fetch origin main
     END={{RELEASE_SHA}}
     git merge-base --is-ancestor "$END" origin/main
     BASE=$(git rev-parse "$END^")
     PREV=$(git log "$BASE" --grep '^chore: release main' --format=%H -n 1)
     test -n "$PREV"
     git diff --name-only --diff-filter=A "$PREV" "$END" -- packages/db/drizzle/'*.sql'
   )
   ```

   Staging and Production migrations run by hand, using
   `pnpm db:migrate:staging` or `pnpm db:migrate:prod`. These guarded commands
   read the login from Secret Manager and require the Release lead to confirm
   the database name; they ignore `packages/db/.env`. Never bypass a refusal
   or use the local migration command for a remote database. See
   [`docs/db-migrations.md`](../../../docs/db-migrations.md#deploying-migrations).

   Read any new migration SQL and its linked rollout notes or feature spec.
   The new apps are already running on Staging, so say in the Overview what is
   expected to fail until the migration runs, and make the migration the first
   step. For Production, the order of the migration and the paused
   `deploy-prod` approvals matters: put the migration first if the new app
   needs it, and if the old app would break on the new schema, state the
   compatible order or maintenance window in the Overview. If the right order
   is unclear, tell the user to raise it in `#monorepo` and pause before
   approving anything.
   Scheduled jobs and workers may already be running against the old schema:
   make confirming migration and worker state a prerequisite to testing; do
   not assume the database is current or pause jobs without accounting for
   their other work.

   No new `.sql` files → **no migration**: drop the migration step and the
   Database queries section from the template. Otherwise fill
   `{{NEWEST_MIGRATION_FILE}}` with the last file name listed.

4. **Skim the linked PRs only for risk.** For each changelog entry, read the
   PR title and, if needed, the first lines of its body. You are looking for
   exactly three things:
   - what a non-developer would call the headline change (for the Overview),
   - anything that breaks while the apps and database are out of step,
   - anything that went straight to production (Homepage always does).

   Do not summarize every PR.

5. **Fill in [`template.md`](template.md).** Renumber the steps after
   dropping any that do not apply. Follow the rules below. Delete every
   `<!-- ... -->` comment and every block marked optional that does not
   apply. Replace every `{{PLACEHOLDER}}`.

6. **Write the draft to a local file**, e.g. `release-plan-<PR>.md` in a
   scratch/temp directory (not in the repo). Show it to the person who asked
   and **stop until they approve** or request changes.

7. **File the issue** only after approval, following the repo
   [`github`](../github/SKILL.md) skill.

   ```bash
   gh issue create --title "Release plan: <short release name> to <Environment> (#<PR>)" \
     --body-file <draft file>
   ```

   No labels, no assignees. If `gh` is not available, suggest installing the
   [GitHub CLI](https://cli.github.com/). If it still isn't available, stop
   after step 6 and tell the person to paste the draft into a new issue.

## Rules for the content

- **Audience:** volunteers who are not all developers. Plain words; explain a
  term the first time only if they must act on it.
- **Never add a section** beyond the ones in the template.
- **Only the risky checklist steps** get **Watch**, **Expected**, and
  **Stop if** sub-bullets, one line each.
- **Database queries** are read-only. Write them from the migration SQL; keep
  to the few that prove the migration applied and that nothing drifted.
- **People:** refer to roles, never names or handles. The template's Who's
  who table is the only place people are named; never invent people or
  roles. When the team changes, edit that table.
- **Analytics** ships separately. Leave it out even if it appears in the
  changelog.

## Staging vs Production

The template is written for Staging. For a Production release, use the
Production column of each row while filling it in.

|                         | Staging                                                                     | Production                                                                              |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Deploy step             | None; already deployed                                                      | Approve each paused `deploy-prod` job (environment `*-production`) on the Actions page  |
| Migration order         | First step; the apps are already running                                    | Before or after the approvals, per the compatible order stated in the Overview          |
| Homepage                | Already published to production when the PR merged — say so in the Overview | Nothing to do                                                                           |
| Database                | Cloud SQL `f3data-nonprod`, database `f3_staging`                           | Cloud SQL `f3data`, database `f3_prod`                                                  |
| Cloud Run and log links | As in the template                                                          | Drop `-staging` from each project ID                                                    |
| Test plan step          | Create the Staging test plan                                                | Drop the step                                                                           |
| Test step               | Run the Staging test plan issue                                             | Repeat only the per-app smoke checks from the Staging test plan against production URLs |
| Database queries        | Run against `f3_staging`                                                    | Run against `f3_prod`                                                                   |
| Last step               | Let it run 24–48 h, then go/no-go for Production                            | Announce done in `#monorepo`                                                            |

## What to leave out

These made past plans too long. Do not include them:

- Version numbers, tag names, or per-app version tables.
- A per-PR summary of the changelog.
- Background on how release-please, Cloud Run, or migrations work.
- Anything about testing features — that belongs in the test plan.
- Placeholder rows for people who are not in the Who's who table.
