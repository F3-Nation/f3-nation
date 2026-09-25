<!--
  Release plan issue body. Replace every {{PLACEHOLDER}}, delete every
  OPTIONAL block that does not apply, then delete all HTML comments.
  Production: apply the "Staging vs Production" table in SKILL.md.
-->

## Overview

{{ONE_TO_THREE_SHORT_PARAGRAPHS: what ships, what is unusual, what to expect mid-release}}

<!-- OPTIONAL (Staging only, when Homepage is in the release): -->

**Homepage has no Staging.** Merging the release PR publishes the Homepage straight to **production** (f3nation.com).

## Who's who

| Role               | What they do                                                                                                                                               | Person                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Release lead       | Merges the release PR, runs any database migration, approves Production, and makes the go/no-go call. The only person who deploys or changes the database. | @taterhead247 (Tackle) |
| Monitor and tester | Watches logs and dashboards, runs the read-only database checks, and runs the test plan                                                                    | @BigGillyStyle (Crash) |

**Slack channel:** `#monorepo`. Announce the start there.

## Stop rule

If anything under **Stop if** happens, post in `#monorepo` and pause. Don't approve any Production deployment. Tackle and Crash decide together what to do next, and only Tackle changes the database.

---

## Checklist

### Step 0: Before release day

<!-- OPTIONAL (only if there is a migration): -->

- [ ] **Confirm database access.** Tackle can connect to the {{ENVIRONMENT}} database with migration rights; Crash can connect read-only. Owner: @taterhead247

<!-- Add at most 2 more pre-checks, only if a migration needs one (e.g. a query that must return 0 first). -->

### Step 1: Deploy (~20–30 min)

- [ ] **Announce the start** in `#monorepo`. Owner: @taterhead247
- [ ] **Merge release PR #{{PR}}.** The deploys start automatically. Owner: @taterhead247

<!-- Production: replace the item below with "Approve each paused production deploy job and wait for it to finish", and drop "Leave those paused". -->

- [ ] **Wait for the deploys to finish** on the [Actions page](https://github.com/F3-Nation/f3-nation/actions). Each app deploys to Staging, then pauses at "waiting for approval" for Production. Leave those paused. Owner: @taterhead247
  - **Watch** (@BigGillyStyle): every "deploy-staging" job turns green, and each Cloud Run service shows a new Ready revision (jobs: a new successful execution). Homepage goes straight to GitHub Pages: no staging job, no Cloud Run revision.
  - **Stop if:** a deploy-staging job fails (red).

<!-- OPTIONAL (only if there is a migration): -->

### Step 2: Run the database migration (~5 min)

- [ ] **Confirm the migration target** from the repository root: `pnpm -F db with-env node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.host+u.pathname)'` prints the host and database name, never the password. Owner: @taterhead247
  - **Expected:** it ends in `/{{DATABASE_NAME: f3_staging or f3_prod}}`.
  - **Stop if:** it names any other database. Fix `packages/env/.env` before going on.
- [ ] **Run the migration** from the repository root, pointed at the {{ENVIRONMENT}} database: `env -u CI pnpm db:migrate`. Owner: @taterhead247
- [ ] **Run [the check query](#check-query-after-the-migration).** Every result must match. Owner: @BigGillyStyle
  - **Expected:** {{WHAT_ERRORS_APPEAR_BETWEEN_DEPLOY_AND_MIGRATION_OR_"none"}}
  - **Stop if:** the migration shows an error, or the check query doesn't match. Retry **once**; if it fails again, stop.

<!-- Production: drop Step 3 and renumber. -->

### Step 3: Create the test plan

- [ ] **Create the Staging test plan** with the `staging-test-plan` agent skill and link it here: #___ Owner: @BigGillyStyle

### Step 4: Test

<!-- Production: "Repeat the per-app smoke checks from the Staging test plan against the production URLs." -->

- [ ] **Work through the test plan.** Owner: @BigGillyStyle
  - **Watch** (@BigGillyStyle): keep the app error logs streaming. Post any new error not on the [known-noise list](#known-noise-ignore-these) in `#monorepo` with the time and what you were doing.

<!-- Production: replace Step 5 with one item: "Announce done in `#monorepo`." Owner: @taterhead247 -->

### Step 5: Let it run, then decide

- [ ] **Let Staging run for 24–48 hours,** checking the app error logs once a day. Owner: @BigGillyStyle
- [ ] **Go/no-go for Production.** Tackle posts the decision as a comment. **Go** means every box above is checked and no errors are unexplained. Production then gets its own release-plan issue. Owner: @taterhead247

---

## If something goes wrong

- **One app misbehaves:** discuss it in `#monorepo` first. If rolling back makes sense, Tackle sends traffic back to the previous revision: Cloud Run → service → **Revisions** → **Manage traffic** → 100% to the revision before this release.

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
| Analytics (job)                                              | [Cloud Run job](https://console.cloud.google.com/run/jobs/details/us-central1/analytics-etl-nonprod/executions?project=f3data) · [Logs](https://console.cloud.google.com/logs/query?project=f3data)              |
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

For @BigGillyStyle. Read-only; run against `f3_staging`. <!-- Production: `f3_prod`. -->

#### Check query: after the migration

```sql
-- {{ONE_LINE_EXPECTATION}}
{{QUERY}}
```
