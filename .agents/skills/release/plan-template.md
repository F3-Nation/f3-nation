<!--
  Release plan issue body. Replace every {{PLACEHOLDER}}, delete every
  OPTIONAL block that does not apply, then delete all HTML comments.
  Production: apply the "Staging and Production" table in SKILL.md.
  Every command and check follows commands.md.
-->

## Overview

{{ONE_TO_THREE_SHORT_PARAGRAPHS: what ships, what is unusual, the order of settings, approvals and migration, what is broken in between and for how long}}

<!-- OPTIONAL (Staging only, when Homepage is in the release): -->

**Homepage has no Staging.** Merging the release PR published the Homepage straight to **production** (apps.f3nation.com).

Every command below is a block to copy, and every check prints `true` or `false` (`t` or `f` in `psql`). Run shell blocks from the repository root, signed in to `gcloud` and `gh`.

## Who's who

| Role          | What they do                                                                                                                                                                                                                                                                                                                                                                                                           | Person                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Release lead  | Runs any database migration, approves Production, and makes the go/no-go call. The only person who deploys the apps or migrates the database.                                                                                                                                                                                                                                                                          | @taterhead247 (Tackle) |
| Monitor       | Watches logs and dashboards, runs the read-only database checks, and runs the test plan                                                                                                                                                                                                                                                                                                                                | @BigGillyStyle (Crash) |
| Refresh admin | Only after a Production migration that can change the refresh login's grants (`docs/STAGING_REFRESH.md`, "Migrations that need the full setup"): re-runs the full Staging refresh setup, which re-grants the refresh job's read-only database login. An Owner of the `f3data` Google Cloud project who can read the spuds database passwords in Secret Manager (`DB_SPUDS_PASSWORD_PROD`, `DB_SPUDS_PASSWORD_STAGING`) | @dnishiyama (Spuds)    |

<!-- Keep the Refresh admin row only when the plan has the re-grant item. -->

**Slack channel:** `#monorepo`. Announce the start there.

## Stop rule

If anything under **Stop if** happens, post in `#monorepo` and pause. Don't approve any Production deployment. The Release lead and Monitor decide together what to do next, and only the Release lead deploys or migrates.

---

## Checklist

### Step 0: Before you start

<!-- OPTIONAL (Production only): -->

- [ ] **Confirm it's a go.** The Staging plan (#{{STAGING_PLAN_ISSUE}}) has a **Go** comment{{AND_ANY_ROLLOUT_GATES}}. Owner: Release lead
  - **Stop if:** it doesn't.

<!-- OPTIONAL (Staging only, when an app with a Staging deploy is in the release): -->

- [ ] **Confirm the Staging deploys finished.** The plans are filed when the release is cut, so a deploy may still be running. Nothing below, and no test in the test plan, starts until each tag's newest Staging deploy has succeeded. The check prints `true` when the tag's own run did. Owner: Release lead

  ```bash
  for TAG in {{EACH_STAGING_DEPLOY_TAG}}; do
    RUN=$(gh run list -R F3-Nation/f3-nation --workflow "deploy-${TAG%@*}.yml" --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
    OK=$(test -n "$RUN" && gh run view "$RUN" -R F3-Nation/f3-nation --json jobs \
      --jq '[.jobs[] | select(.name | endswith("deploy-staging"))] | length > 0 and all(.conclusion == "success")')
    test "$OK" = true && echo "staging $TAG: true" || echo "staging $TAG: false"
  done
  ```

  - **Then check for redeploys started by hand,** whatever the check printed: they run from `main` with the tag as an input, so the check can't see them. On each app's deploy workflow in the [Actions page](https://github.com/F3-Nation/f3-nation/actions), look for a run started from `main` after the tag's run. Still running: wait for it. Its `deploy-staging` job succeeded: that tag is done, even if its line printed `false`. Failed: post in `#monorepo` and stop.
  - **If a line prints `false` and no redeploy succeeded:** open the tag's run. Still running: wait and run the check again. Failed: post in `#monorepo` and stop.

- [ ] **Announce the start** in `#monorepo`. Owner: Release lead

<!-- OPTIONAL (only if there is a migration): -->

- [ ] **Confirm database access.** The Release lead can read the migration login; the Monitor can connect read-only to `{{DATABASE_NAME}}` (the next check starts by confirming the database). Owner: Release lead

  ```bash
  gcloud secrets versions access latest --secret {{MIGRATE_SECRET: MIGRATE_DATABASE_URL_STAGING or MIGRATE_DATABASE_URL_PROD}} --project f3data >/dev/null && echo "migration login readable: true" || echo "migration login readable: false"
  ```

<!-- OPTIONAL (only if the migration can refuse data): Production adds "Run it a day early" to the Overview. -->

- [ ] **Run the pre-migration checks** in `psql` connected read-only to `{{DATABASE_NAME}}`. Owner: Monitor

  ```sql
  SET default_transaction_read_only = on;
  -- Expect: t.
  SELECT current_database() = '{{DATABASE_NAME}}' AS right_database;
  -- Expect: all_ok = t. {{WHAT_A_NONZERO_DETAIL_MEANS}}
  {{PRE_CHECK_QUERY}}
  ```

  - **Expected:** every result is `t`.
  - **Stop if:** any is `f`. Don't migrate.

<!-- OPTIONAL (only if a migration merges, moves or deletes rows): -->

- [ ] **Back up the rows the migration changes.** Keep the file in restricted storage, never in Slack or the repo: {{WHAT_IT_HOLDS}}. Owner: Release lead

  In `psql` connected to `{{DATABASE_NAME}}`:

  ```
  {{BACKUP_COPY_COMMAND}}
  ```

  Then, in the shell, from the folder `psql` ran in:

  ```bash
  {{BACKUP_FILE_CHECK}}
  ```

  - **Stop if:** the export fails or the check prints `false`.

<!-- OPTIONAL (only if the release needs a setting changed before or while it deploys; one item per setting): -->

### Step 1: Settings (~{{N}} min)

- [ ] **{{WHAT_THE_SETTING_DOES}}** {{WHEN_TO_RUN_IT_AND_WHY_IT_IS_SAFE}}. Owner: Release lead

  ```bash
  {{CHANGE_COMMAND}}
  ```

  Check:

  ```bash
  {{CHECK_COMMAND}}
  ```

  - **Expected:** `true`.
  - **Stop if:** the change fails or the check prints `false`.

<!-- OPTIONAL (Production only). Split into one step per approval group when the migration sits between them. -->

### Step 2: Deploy {{WHICH_APPS}} (~{{N}} min)

- [ ] **Approve {{WHICH_APPS}},** then wait for them. Or use the [Actions page](https://github.com/F3-Nation/f3-nation/actions). Owner: Release lead

  ```bash
  {{APPROVE_AND_WATCH_LOOP}}
  ```

  - **Watch** (Monitor): each service shows a new Ready revision.
  - **Stop if:** any line prints `false`.

<!-- OPTIONAL (only if there is a migration). Production: place it per the order in the Overview. -->

### Step 3: Run the database migration (~5 min)

- [ ] **Check out this release.** Owner: Release lead

  ```bash
  test -z "$(git status --porcelain)" && echo "clean tree: true" || echo "clean tree: false"
  ```

  Only if that printed `true`:

  ```bash
  git fetch origin main && git switch --detach {{RELEASE_SHA}} && pnpm install --frozen-lockfile && echo "checkout and install: true" || echo "checkout and install: false"
  test "$(git rev-parse HEAD)" = {{RELEASE_SHA}} && echo "right commit: true" || echo "right commit: false"
  test "$(ls packages/db/drizzle/*.sql | tail -n 1)" = packages/db/drizzle/{{NEWEST_MIGRATION_FILE}} && echo "newest migration: true" || echo "newest migration: false"
  ```

  - **Stop if:** any line prints `false`, or fetch, checkout or install fails.

- [ ] **Start the database proxy** in a second terminal and leave it running. The first time on a machine, run `gcloud auth application-default login` before it. Owner: Release lead

  ```bash
  {{PROXY_COMMAND}}
  ```

  Back in the first terminal:

  ```bash
  pg_isready -h 127.0.0.1 -p {{PROXY_PORT}} >/dev/null && echo "proxy ready: true" || echo "proxy ready: false"
  ```

  - **Stop if:** the proxy exits or the check prints `false`.

- [ ] **Run the migration.** It reads the database login from Secret Manager, checks the checkout's migrations are main's and agree with the database, lists the pending migrations, and asks you to type the database name. Owner: Release lead

  ```bash
  pnpm db:migrate:{{staging or prod}}
  ```

  - **Expected:** it lists {{EACH_MIGRATION_IN_THIS_RELEASE}} as pending, nothing else; lines starting `note:` are informational. Type `{{DATABASE_NAME}}` and it prints `Done: {{DATABASE_NAME}} is at <that migration>.` On Production it then says whether it started the Staging refresh image rebuild (Step 5 uses that). If nothing is pending, the migration already ran: go on to the check.
  - **Stop if:** it prints `REFUSED`, or lists a migration this release doesn't include. Don't work around a refusal: post it in `#monorepo` and pause.

- [ ] **Check the migration** in `psql` connected read-only to `{{DATABASE_NAME}}`. Owner: Monitor

  ```sql
  SET default_transaction_read_only = on;
  -- Expect: t.
  SELECT current_database() = '{{DATABASE_NAME}}' AS right_database;
  -- Expect: all_ok = t.
  {{CHECK_QUERY}}
  ```

  - **Expected:** every result is `t`. {{WHAT_IS_BROKEN_UNTIL_NOW_AND_FIXED_AFTER}}
  - **Stop if:** the migration shows an error, or any result is `f`. A `lock timeout` error is safe to retry **once**; any other error, or a second failure, stop.

- [ ] **Return to your branch.** Owner: Release lead

  ```bash
  git switch -
  ```

### Step 4: Test

<!-- scripts/check-filed-plans.sh finds the link by "Staging test plan, #<n>"; change both together. -->

- [ ] **Work through the Staging test plan, #{{TEST_PLAN_ISSUE}}.** Owner: Monitor
  - **Watch** (Monitor): keep the app error logs streaming. Post any new error not on the [known-noise list](#known-noise-ignore-these) in `#monorepo` with the time and what you were doing. {{ANYTHING_ELSE_TO_WATCH}}

<!-- OPTIONAL (Production only, when there is a migration; keep the re-grant item only when a migration has needs_refresh_setup): -->

### Step 5: Staging refresh follow-up

{{WHY: with a needs_refresh_setup migration, "<those migrations> change what the Staging refresh's login can read, so the refresh needs its login re-granted, then its image rebuilt once more after the re-grant."; otherwise "The Staging refresh image must be rebuilt so it knows this release's migrations; the migration command started that rebuild, so this checks it finished."}} These items are outside the Stop rule and don't hold up the release; if one fails, post it in `#monorepo` so the next Staging refresh waits until it's fixed.

- [ ] **Re-grant the Staging refresh login.** First stop any database proxy still running from the migration (Ctrl-C in its terminal): the setup starts its own on the same ports. The setup grants its runners again, so the list is read from the job's current runners (the members of the role the setup grants them). No `pnpm install` is needed: the image builds in Cloud Build. Owner: Refresh admin

  ```bash
  test -z "$(git status --porcelain)" && echo "clean tree: true" || echo "clean tree: false"
  RUNNERS=$(gcloud run jobs get-iam-policy f3-staging-refresh --project f3data --region us-central1 --format=json \
    | jq -r '[(.bindings // [])[] | select(.role == "roles/run.jobsExecutorWithOverrides") | .members[]] | join(" ")')
  test -n "$RUNNERS" && echo "runners found: true" || echo "runners found: false"
  ```

  - **Stop if:** either line prints `false`. With no runners found, post in `#monorepo` rather than typing a list in: the setup grants exactly what it's given.

  Only if both printed `true`, in the same terminal:

  ```bash
  if git fetch origin main && git switch --detach {{RELEASE_SHA}}; then
    STAGING_REFRESH_RUNNERS="$RUNNERS" bash tooling/scripts/staging-refresh/setup.sh && OK=true || OK=false
    git switch -
    echo "setup ok: $OK"
  else
    echo "checkout ok: false"
  fi
  ```

  - **Expected:** the setup ends with `Done. Image …` and no errors, then `setup ok: true`. The notes it prints every time (the GitHub environment and the slackbot restart) are informational once they're set up.

<!-- Keep exactly one of the two rebuild items: the first when the plan has the re-grant item, else the second. -->

- [ ] **Rebuild the Staging refresh image once more,** after the re-grant above: the re-grant deploys an image built from its own checkout, so this rebuild from `main` must come last, even though the migration already started one. This run replaces the one the migration started, which needs no check. Anyone with write access to the repo can run it. Owner: Release lead

  ```bash
  OUT=$(gh workflow run rebuild-staging-refresh.yml -R F3-Nation/f3-nation --ref main 2>&1) && STARTED=true || STARTED=false
  RUN=$(printf '%s' "$OUT" | grep -oE 'actions/runs/[0-9]+' | head -n 1 | cut -d/ -f3)
  if [ "$STARTED" = false ]; then
    echo "rebuild started: false"; printf '%s\n' "$OUT"
  elif [ -n "$RUN" ]; then
    gh run watch "$RUN" -R F3-Nation/f3-nation --exit-status >/dev/null 2>&1 \
      && echo "rebuild green: true" || echo "rebuild green: false"
  else
    echo "run found: false"
  fi
  ```

  - **If it prints `rebuild started: false`:** the run wasn't created; the line after it says why. Fix that and run the block again.
  - **If it prints `run found: false`:** the run was started, but `gh` didn't print its link (older `gh` versions don't). Find it on the [workflow's Actions page](https://github.com/F3-Nation/f3-nation/actions/workflows/rebuild-staging-refresh.yml) and confirm it went green; don't start another.

- [ ] **Check the Staging refresh image rebuild** that `pnpm db:migrate:prod` started after the migration. Open the [workflow's Actions page](https://github.com/F3-Nation/f3-nation/actions/workflows/rebuild-staging-refresh.yml): the newest run, started by the Release lead after the migration, must finish green. Owner: Release lead
  - **If the migration printed `Couldn't start the Staging refresh image rebuild`,** or no run started after the migration: start one and watch it with the block below. Anyone with write access to the repo can run it.

    ```bash
    OUT=$(gh workflow run rebuild-staging-refresh.yml -R F3-Nation/f3-nation --ref main 2>&1) && STARTED=true || STARTED=false
    RUN=$(printf '%s' "$OUT" | grep -oE 'actions/runs/[0-9]+' | head -n 1 | cut -d/ -f3)
    if [ "$STARTED" = false ]; then
      echo "rebuild started: false"; printf '%s\n' "$OUT"
    elif [ -n "$RUN" ]; then
      gh run watch "$RUN" -R F3-Nation/f3-nation --exit-status >/dev/null 2>&1 \
        && echo "rebuild green: true" || echo "rebuild green: false"
    else
      echo "run found: false"
    fi
    ```

    `rebuild started: false` means no run was created (the line after it says why); `run found: false` means it started but `gh` printed no link, so check the Actions page instead of starting another.

### Step 6: Let it run, then decide

- [ ] **Let Staging run for 24–48 hours,** checking the app error logs once a day. Owner: Monitor
- [ ] **Go/no-go for Production.** The Release lead posts the decision as a comment. **Go** means every box above is checked and no errors are unexplained. Production then gets its own release plan. Owner: Release lead

<!-- OPTIONAL (follow-ups the release needs that aren't part of the deploy; one item each, with its command, check and rollback): -->

### Step 7: Later

- [ ] **{{FOLLOW_UP}}** {{WHEN_AND_WHAT_IS_AFFECTED_MEANWHILE}}. Owner: Release lead

  ```bash
  {{CHANGE_COMMAND}}
  ```

  Check:

  ```bash
  {{CHECK_COMMAND}}
  ```

  If it fails:

  ```bash
  {{ROLLBACK_COMMAND}}
  ```

---

## If something goes wrong

- **One app (Cloud Run service) misbehaves:** discuss it in `#monorepo` first. If rolling back makes sense, the Release lead sends traffic back to the revision before this release (set `SERVICE` and `PROJECT` from the [Monitoring reference](#monitoring-reference)):

  ```bash
  SERVICE=service-name PROJECT=project-id
  gcloud run revisions list --service "$SERVICE" --project "$PROJECT" --region us-central1 --limit 3 \
    --format='table(metadata.name,metadata.creationTimestamp)'
  REV=paste-the-revision-before-this-release
  gcloud run services update-traffic "$SERVICE" --project "$PROJECT" --region us-central1 --to-revisions "$REV=100"
  ```

  Traffic then stays on that revision until `--to-latest` sends it back.{{APPS_NOT_TO_ROLL_BACK_AND_WHY}}

<!-- OPTIONAL (only if there is a migration): one bullet on how to undo it, naming the backup and any restore notes. -->
<!-- OPTIONAL (one bullet per setting change, with its rollback block). -->

- **In every case:** don't approve any more Production deploys.

## Monitoring reference

Opening these needs a Google account with at least viewer access to the project.

<!-- Keep only rows for apps in this release. -->

| What                                                         | Where                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy progress                                              | [GitHub Actions](https://github.com/F3-Nation/f3-nation/actions)                                                                                                                                                             |
| API                                                          | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-api/revisions?project=f3-api-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-api-app-staging)                            |
| Auth                                                         | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-auth/revisions?project=f3-authentication-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-authentication-staging)             |
| Admin                                                        | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-admin/revisions?project=f3-admin-portal-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-admin-portal-staging)                |
| Map                                                          | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-map/revisions?project=f3-map-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-map-app-staging)                            |
| Me                                                           | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-me/revisions?project=f3-me-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-me-app-staging)                               |
| Region Pages                                                 | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-region-pages/revisions?project=f3-region-pages-app-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-region-pages-app-staging) |
| Slackbot                                                     | [Cloud Run](https://console.cloud.google.com/run/detail/us-central1/f3-slackbot/revisions?project=f3-slackbot-staging) · [Logs](https://console.cloud.google.com/logs/query?project=f3-slackbot-staging)                     |
| Database (Cloud SQL `f3data-nonprod`, database `f3_staging`) | [Overview and metrics](https://console.cloud.google.com/sql/instances/f3data-nonprod/overview?project=f3data) · [Logs](https://console.cloud.google.com/logs/query?project=f3data)                                           |

**App error query:** paste into Logs, set the range to "Last 1 hour", and turn on **Stream logs**.

```
(resource.type="cloud_run_revision" OR resource.type="cloud_run_job") AND severity>=ERROR
```

#### Known noise (ignore these)

- `api.openapi.handler_error`, only at the rate seen before the release. A new path or a jump in volume is a real error.
- `api.map_revalidate.missing_config`
- Slackbot: `The request was aborted because there was no available instance`
