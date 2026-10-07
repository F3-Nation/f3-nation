<!--
  Release plan issue body. Replace every {{PLACEHOLDER}}, delete every
  OPTIONAL block that does not apply, then delete all HTML comments.
  Production: apply the "Staging vs Production" table in this folder's SKILL.md.
-->

## Overview

{{ONE_TO_THREE_SHORT_PARAGRAPHS: what ships, what is unusual, what to expect mid-release}}

<!-- OPTIONAL (Staging only, when Homepage is in the release): -->

**Homepage has no Staging.** Merging the release PR publishes the Homepage straight to **production** (apps.f3nation.com).

## Who's who

| Role         | What they do                                                                                                                                               | Person                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Release lead | Merges the release PR, runs any database migration, approves Production, and makes the go/no-go call. The only person who deploys or changes the database. | @taterhead247 (Tackle) |
| Monitor      | Watches logs and dashboards, runs the read-only database checks, and runs the test plan                                                                    | @BigGillyStyle (Crash) |

**Slack channel:** `#monorepo`. Announce the start there.

## Stop rule

If anything under **Stop if** happens, post in `#monorepo` and pause. Don't approve any Production deployment. The Release lead and Monitor decide together what to do next, and only the Release lead changes the database.

---

## Checklist

### Step 0: Before release day

<!-- OPTIONAL (only if there is a migration): -->

- [ ] **Confirm database access.** The Release lead can connect to the {{ENVIRONMENT}} database with migration rights; the Monitor can connect read-only. Owner: Release lead

<!-- Add at most 2 more pre-checks, only if a migration needs one (e.g. a query that must return 0 first). -->

### Step 1: Deploy (~20–30 min)

<!-- Already merged: mark the merge item complete, omit its pre-merge checks, and adapt the wait item to the verified deployment state. Leave unverified work unchecked. -->

- [ ] **Announce the start** in `#monorepo`. Owner: Release lead
- [ ] **Merge release PR #{{PR}}.** The deploys start automatically. Owner: Release lead
  - **Expected:** immediately before merging, `gh pr view {{PR}} --json state,headRefOid --jq '[.state, .headRefOid] | join(" ")'` prints `OPEN {{RELEASE_SHA}}`.
  - **Stop if:** the state or SHA differs, or the check fails. Update and review this plan before continuing.

<!-- OPTIONAL (only if this plan merges before a pending migration; omit when already merged or when the migration precedes merge): -->

- [ ] **Refresh the migration steps after merging.** Record the actual merge commit, rerun migration discovery, and update the checkout to fetch `main` at that SHA and expect the newest migration filename. Review the migration list and rollout order before continuing. Owner: Release lead

<!-- Production: replace the item below with "Approve each paused production deploy job and wait for it to finish", and drop "Leave those paused". Watch: every `deploy-prod` job (environment `*-production`) turns green, and each Production service shows a new Ready revision. Stop if: a `deploy-prod` job fails (red). -->

- [ ] **Wait for the deploys to finish** on the [Actions page](https://github.com/F3-Nation/f3-nation/actions). Each app deploys to Staging, then pauses at "waiting for approval" for Production. Leave those paused. Owner: Release lead
  - **Watch** (Monitor): every "deploy-staging" job turns green, and each Cloud Run service shows a new Ready revision (jobs: the job shows the new image; deploying does not run it). Homepage goes straight to GitHub Pages: no staging job, no Cloud Run revision.
  - **Stop if:** a deploy-staging job fails (red).

<!-- OPTIONAL (only if there is a migration): -->
<!-- Staging or Production: if the new app or job requires the migration first, move Step 2 before its deployment or execution and renumber. Check old-app compatibility and state the chosen order in the Overview. If already deployed, confirm migration and worker state before testing. -->

### Step 2: Run the database migration (~5 min)

- [ ] **Check out this release** from the repository root. `git status --porcelain` must print nothing; then run `git fetch origin {{RELEASE_FETCH_REF}} && git switch --detach {{RELEASE_SHA}} && pnpm install --frozen-lockfile`. Owner: Release lead
  - **Expected:** `git rev-parse HEAD` prints `{{RELEASE_SHA}}`, and `ls packages/db/drizzle/*.sql | tail -n 1` prints `packages/db/drizzle/{{NEWEST_MIGRATION_FILE}}`.
  - **Stop if:** the tree isn't clean, fetch/checkout/install fails, the SHA differs, or a different file prints.
- [ ] **Confirm the migration target** from the repository root: `pnpm -F db with-env node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.host+u.pathname)'` prints the host and database name, never the password. Owner: Release lead
  - **Expected:** it ends in `/{{DATABASE_NAME: f3_staging or f3_prod}}`.
  - **Stop if:** it names any other database. Fix `packages/db/.env` before going on.
- [ ] **Confirm the release snapshot** immediately before running the migration: `gh pr view {{PR}} --json state,headRefOid,mergeCommit --jq 'if .state == "OPEN" then .headRefOid elif .state == "MERGED" then .mergeCommit.oid else "STOP" end'`. Owner: Release lead
  - **Expected:** it prints `{{RELEASE_SHA}}`: the current PR head while open, or the actual merge commit after merging.
  - **Stop if:** it prints anything else, or the check fails. Update and review the migration list, rollout order, and checkout steps before continuing; do not repeat a migration already run.
- [ ] **Run the migration** from the repository root, pointed at the {{ENVIRONMENT}} database: `env -u CI pnpm db:migrate`. Owner: Release lead
- [ ] **Run [the check query](#check-query-after-the-migration).** Every result must match. Owner: Monitor
  - **Expected:** {{WHAT_ERRORS_APPEAR_BETWEEN_DEPLOY_AND_MIGRATION_OR_"none"}}
  - **Stop if:** the migration shows an error, or the check query doesn't match. Retry **once**; if it fails again, stop.
- [ ] **Return to your branch:** `git switch -`. Owner: Release lead

<!-- Production: drop Step 3 and renumber. -->

### Step 3: Create the test plan

- [ ] **Create the Staging test plan** with the `staging-test-plan` agent skill and link it here: #___ Owner: Monitor

### Step 4: Test

<!-- Production: "Repeat the per-app smoke checks from the Staging test plan against the production URLs." -->

- [ ] **Work through the test plan.** Owner: Monitor
  - **Watch** (Monitor): keep the app error logs streaming. Post any new error not on the [known-noise list](#known-noise-ignore-these) in `#monorepo` with the time and what you were doing.

<!-- Production: replace Step 5 with one item: "Announce done in `#monorepo`." Owner: Release lead -->

### Step 5: Let it run, then decide

- [ ] **Let Staging run for 24–48 hours,** checking the app error logs once a day. Owner: Monitor
- [ ] **Go/no-go for Production.** The Release lead posts the decision as a comment. **Go** means every box above is checked and no errors are unexplained. Production then gets its own release-plan issue. Owner: Release lead

---

## If something goes wrong

- **One app (Cloud Run service) misbehaves:** discuss it in `#monorepo` first. If rolling back makes sense, the Release lead sends traffic back to the previous revision: Cloud Run → service → **Revisions** → **Manage traffic** → 100% to the revision before this release.

<!-- OPTIONAL (only if there is a migration): one bullet on how to undo it, linking the migration's own rollback notes if they exist. -->

- **In every case:** don't approve Production.

## Monitoring reference

Opening these needs a Google account with at least viewer access to the project.

<!-- Keep only rows for apps in this release. -->

| What                                                         | Where                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy progress                                              | [GitHub Actions](https://github.com/F3-Nation/f3-nation/actions)                                                                                                                                                 |
| API                                                          | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-api/revisions?project=f3-api-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-api-app-staging)                |
| Auth                                                         | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-auth/revisions?project=f3-authentication-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-authentication-staging) |
| Admin                                                        | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-admin/revisions?project=f3-admin-portal-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-admin-portal-staging)    |
| Map                                                          | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-map/revisions?project=f3-map-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-map-app-staging)                |
| Me                                                           | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-me/revisions?project=f3-me-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-me-app-staging)                   |
| Slackbot                                                     | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-slackbot/revisions?project=f3-slackbot-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-slackbot-staging)         |
| Database (Cloud SQL `f3data-nonprod`, database `f3_staging`) | [Overview and metrics](https://console.cloud.google.com/sql/instances/f3data-nonprod/overview?project=f3data) · [Logs](https://console.cloud.google.com/logs/query?project=f3data)                               |

**App error query:** paste into Logs, set the range to "Last 1 hour", and turn on **Stream logs**.

```
(resource.type="cloud_run_revision" OR resource.type="cloud_run_job") AND severity>=ERROR
```

#### Known noise (ignore these)

- `api.openapi.handler_error`, only at the rate seen before the release. A new path or a jump in volume is a real error.
- `api.map_revalidate.missing_config`
- Slackbot: `The request was aborted because there was no available instance`

<!-- OPTIONAL (only if there is a migration): -->

## Database queries

For the Monitor. Read-only; run against `f3_staging`. <!-- Production: `f3_prod`. -->

#### Check query: after the migration

```sql
-- {{ONE_LINE_EXPECTATION}}
{{QUERY}}
```
