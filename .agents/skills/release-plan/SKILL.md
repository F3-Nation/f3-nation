---
name: release-plan
description: Draft and file the GitHub issue that walks the release team through shipping a release-please release to Staging or Production — who does what, step-by-step checklist, stop rules, monitoring links. Use when someone asks for a "release plan" for a release PR.
---

# Release plan issue

Produces one GitHub issue that the release team works through, top to bottom,
on release day. It is a **checklist, not a report**. The reference for the
right amount of detail is
[F3-Nation/f3-nation#1068](https://github.com/F3-Nation/f3-nation/issues/1068).
Never write more than that; shorter is better.

The Staging test plan is a separate issue made by the
[`staging-test-plan`](../staging-test-plan/SKILL.md) skill. Do not put test
steps in this issue.

## Inputs

Ask for anything missing before starting:

1. **Release PR number** — the open (or just-merged) `chore: release main` PR
   opened by release-please.
2. **Environment** — `Staging` (default) or `Production`.

## Steps

1. **Read the release PR.**

   ```bash
   gh pr view <PR> --json title,body,state,mergedAt,headRefOid,mergeCommit --jq '{title,state,mergedAt,headRefOid,mergeCommit,body}'
   ```

   The body is the changelog: one `<details>` block per app, listing the
   merged PRs and issues. Note which apps are releasing. Ignore the version
   numbers — they never go in the issue.

   If the PR has already merged, mark its merge step complete and check the
   deployment jobs before describing what remains. Leave unverified deploy,
   migration, and test steps unchecked; a merged PR does not prove they finished.

2. **Find new database migrations.** The previous release is the last
   `chore: release main` commit on `main` before this PR's changes:

   For both migration discovery and checkout, set `{{RELEASE_FETCH_REF}}` to
   `refs/pull/<PR>/head` and `{{RELEASE_SHA}}` to `headRefOid` while the PR is
   open. After merging, use `main` and `mergeCommit.oid`. This keeps both
   steps on the same release snapshot, even if `main` has advanced.

   ```bash
   git fetch origin main
   git fetch origin {{RELEASE_FETCH_REF}}
   END={{RELEASE_SHA}}
   # Both states: find the previous release, excluding this release's own commit.
   PREV=$(git log "$(git merge-base origin/main "$END^")" --grep '^chore: release main' --format=%H -n 1)
   git diff --name-only --diff-filter=A "$PREV" "$END" -- packages/db/drizzle/'*.sql'
   ```

   Re-read the PR state and SHA immediately before merging or migrating.
   Stop if they no longer match the plan. If the plan merges before a pending
   migration, include a checkpoint after merging to refresh discovery and
   checkout to the actual merge commit, then review the updated migration
   list and rollout order before continuing. Do not migrate from the saved
   open-PR head after merging or blindly repeat a migration already run.

   Read any new migration SQL and its linked rollout notes or feature spec
   before choosing the order. A migration required by the new app or scheduled
   job must precede that deployment or execution. If it would break the old app,
   state the compatible sequence or maintenance window in the Overview. For an
   already-deployed release, make confirming migration and worker state a
   prerequisite to testing; do not assume the database is current or pause jobs
   without accounting for their other work.

   No new `.sql` files → **no migration**: drop Step 2 and the Database
   queries section from the template. Otherwise fill
   `{{NEWEST_MIGRATION_FILE}}` with the last file name listed.

3. **Skim the linked PRs only for risk.** For each changelog entry, read the
   PR title and, if needed, the first lines of its body. You are looking for
   exactly three things:
   - what a non-developer would call the headline change (for the Overview),
   - anything that breaks while the apps and database are out of step,
   - anything that goes straight to production (Homepage always does).

   Do not summarize every PR.

4. **Fill in [`template.md`](template.md).** Reorder and renumber checklist
   steps to match the verified rollout requirements. Follow the rules below. Delete
   every `<!-- ... -->` comment and every block marked optional that does not
   apply. Replace every `{{PLACEHOLDER}}`.

5. **Write the draft to a local file**, e.g. `release-plan-<PR>.md` in a
   scratch/temp directory (not in the repo). Show it to the person who asked
   and **stop until they approve** or request changes.

6. **File the issue** only after approval, following the repo
   [`github`](../github/SKILL.md) skill.

   ```bash
   gh issue create --title "Release plan: <short release name> to <Environment> (#<PR>)" \
     --body-file <draft file>
   ```

   No labels, no assignees. If `gh` is not available, suggest installing the
   [GitHub CLI](https://cli.github.com/). If it still isn't available, stop
   after step 5 and tell the person to paste the draft into a new issue.

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

|                         | Staging                                                                                                                      | Production                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Step 1 action           | Merge if still open; otherwise verify the remaining Staging deploys                                                          | Approve each paused `deploy-prod` job (environment `*-production`) on the Actions page                    |
| Migration order         | Follow the migration's rollout requirements; deploy then migrate only when the new app or job can run against the old schema | Follow the rollout requirements and old-app compatibility; state the order before any Production approval |
| Homepage                | Already published to production when the PR merges — say so in the Overview                                                  | Nothing to do                                                                                             |
| Database                | Cloud SQL `f3data-nonprod`, database `f3_staging`                                                                            | Cloud SQL `f3data`, database `f3_prod`                                                                    |
| Cloud Run and log links | As in the template                                                                                                           | Drop `-staging` from each project ID                                                                      |
| Step 3 (test plan)      | Create the Staging test plan                                                                                                 | Drop the step                                                                                             |
| Test step               | Run the Staging test plan issue                                                                                              | Repeat only the per-app smoke checks from the Staging test plan against production URLs                   |
| Database queries        | Run against `f3_staging`                                                                                                     | Run against `f3_prod`                                                                                     |
| Last step               | Let it run 24–48 h, then go/no-go for Production                                                                             | Announce done in `#monorepo`                                                                              |

## What to leave out

These made past plans too long. Do not include them:

- Version numbers, tag names, or per-app version tables.
- A per-PR summary of the changelog.
- Background on how release-please, Cloud Run, or migrations work.
- Anything about testing features — that belongs in the test plan.
- Placeholder rows for people who are not in the Who's who table.
