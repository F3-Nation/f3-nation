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
   gh pr view <PR> --json title,body,state,mergedAt --jq '{title,state,mergedAt,body}'
   ```

   The body is the changelog: one `<details>` block per app, listing the
   merged PRs and issues. Note which apps are releasing. Ignore the version
   numbers — they never go in the issue.

2. **Find new database migrations.** The previous release is the last
   `chore: release main` commit on `main` before this PR's changes:

   ```bash
   git fetch origin main
   # Release PR still open: diff the last release against main.
   PREV=$(git log origin/main --grep '^chore: release main' --format=%H -n 1)
   END=origin/main
   # Release PR already merged: diff the release before it against this release's merge.
   # END=$(git log origin/main --grep '^chore: release main (#<PR>)' --format=%H -n 1)
   # PREV=$(git log "$END^" --grep '^chore: release main' --format=%H -n 1)
   git diff --name-only --diff-filter=A "$PREV" "$END" -- packages/db/drizzle/'*.sql'
   ```

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

4. **Fill in [`template.md`](template.md).** Follow the rules below. Delete
   every `<!-- ... -->` comment and every block marked optional that does not
   apply. Replace every `{{PLACEHOLDER}}`.

5. **Write the draft to a local file**, e.g. `release-plan-<PR>.md` in a
   scratch/temp directory (not in the repo). Show it to the person who asked
   and **stop until they approve** or request changes.

6. **File the issue** only after approval. Follow the repo
   [`github`](../github/SKILL.md) skill: run its pre-check with
   `--require-write` and end the body with its `_written by <model_name>_`
   signature.

   ```bash
   gh issue create --title "Release plan: <short release name> to <Environment> (#<PR>)" \
     --body-file <draft file>
   ```

   No labels, no assignees. If `gh` is not available to you, stop after
   step 5 and tell the person to paste the draft into a new issue.

## Rules for the content

- **Audience:** volunteers who are not all developers. Plain words; explain a
  term the first time only if they must act on it.
- **Fixed sections, in this order:** Overview, Who's who, Stop rule,
  Checklist, If something goes wrong, Monitoring reference, Database queries
  (only if there is a migration). **Never add a section.**
- **Overview:** at most 3 short paragraphs or 1 paragraph + a numbered list of
  at most 3 items. What ships, what is unusual about this release, and what
  to expect mid-release.
- **No app versions anywhere.** Say "Map", not "map 7.3.4 → 7.4.0".
- **Every checklist item** is one bold action sentence, optionally one more
  sentence, then `Owner: @handle`. Only the risky steps get **Watch**,
  **Expected**, and **Stop if** sub-bullets, one line each.
- **Database queries** are read-only and each has a one-line "Expect …".
  Write them from the migration SQL; keep to the few that prove the migration
  applied and that nothing drifted.
- **People.** Only these two are named. Do not invent other roles.

  | Person | GitHub           | F3 role                | Does                                                                                                                                       |
  | ------ | ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | Tackle | `@taterhead247`  | Nation IT Weaselshaker | Release lead: merges the release PR, runs migrations, approves Production, makes go/no-go. The only one who deploys or changes a database. |
  | Crash  | `@BigGillyStyle` | Nation Code Q          | Monitor and tester: watches logs/dashboards, runs read-only DB checks, creates and runs the test plan.                                     |

## Staging vs Production

|                         | Staging                                                                     | Production                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 action           | Merge the release PR; staging deploys start automatically                   | Approve each paused `deploy-prod` job (environment `*-production`) on the Actions page; drop the Staging Analytics run                   |
| Migration order         | Deploy, then migrate                                                        | Migrate before approving if Staging's "Expected" line was not "none", unless the migration breaks the old app; say which in the Overview |
| Homepage                | Already published to production when the PR merges — say so in the Overview | Nothing to do                                                                                                                            |
| Database                | Cloud SQL `f3data-nonprod`, database `f3_staging`                           | Cloud SQL `f3data`, database `f3_prod`                                                                                                   |
| Cloud Run and log links | As in the template                                                          | Drop `-staging` from each project ID; Analytics: job `analytics-etl` (same `f3data` project)                                             |
| Step 3 (test plan)      | Create the Staging test plan                                                | Drop the step                                                                                                                            |
| Test step               | Run the Staging test plan issue                                             | Repeat only the per-app smoke checks from the Staging test plan against production URLs                                                  |
| Database queries        | Run against `f3_staging`                                                    | Run against `f3_prod`                                                                                                                    |
| Last step               | Let it run 24–48 h, then go/no-go for Production                            | Announce done in `#monorepo`                                                                                                             |

## What to leave out

These made past plans too long. Do not include them:

- Version numbers, tag names, or per-app version tables.
- A per-PR summary of the changelog.
- Background on how release-please, Cloud Run, or migrations work.
- Anything about testing features — that belongs in the test plan.
- Placeholder rows for people who are not listed above.
