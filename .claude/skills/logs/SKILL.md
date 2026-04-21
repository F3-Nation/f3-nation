---
name: logs
description: Query Cloud Run logs for any monorepo app. Use when the user wants to check service logs, errors, or request patterns in staging or prod.
argument-hint: "[app] [prod|staging] [errors|warnings] [count] [timerange]"
---

# Cloud Run Logs

Query Cloud Run logs for any app in this monorepo. Defaults to **auth** on **staging** if no app is specified.

## Registered Apps

See `apps.conf` for the full registry. Currently:

| App    | Staging Project             | Prod Project        | Region        |
| ------ | --------------------------- | ------------------- | ------------- |
| `auth` | `f3-authentication-staging` | `f3-authentication` | `us-east1`    |
| `api`  | `f3-api-472214`             | `f3-api-472214`     | `us-central1` |
| `map`  | `pin-mastery`               | `pin-mastery`       | `us-central1` |

## Instructions

When the user runs this skill, use the helper scripts in `scripts/` to fetch and format logs. Pass through all user arguments verbatim.

### Step 1 — Fetch logs

Run the fetch script with the user's arguments:

```bash
bash .claude/skills/logs/scripts/fetch-logs.sh $ARGS > /tmp/f3-logs.json
```

The script handles all argument parsing (app, environment, severity, time range, limit, custom filters) and writes JSON to stdout. Metadata (app, env, project, service, limit, filter) is printed to stderr.

### Step 2 — Format and display

Pipe the JSON through the format script:

```bash
cat /tmp/f3-logs.json | bash .claude/skills/logs/scripts/format-logs.sh
```

This produces a markdown table with columns: Timestamp, Severity, Method + URL, Status, Latency, Remote IP — plus a summary footer with counts and status code breakdown.

### Step 3 — Follow up

If there are errors, offer to dig deeper into specific log entries by their `insertId`.

### Examples

**Basic queries (default app is `auth`, default env is `staging`):**

- **`/logs`** — 20 most recent auth staging entries
- **`/logs prod`** — 20 most recent auth prod entries
- **`/logs errors`** — Auth staging errors only
- **`/logs warnings 1h`** — Auth staging warnings from the last hour

**Specifying an app:**

- **`/logs api`** — 20 most recent api staging entries
- **`/logs map prod`** — 20 most recent map prod entries
- **`/logs auth prod errors 1h`** — Auth prod errors from the last hour

**Adjusting volume and time range:**

- **`/logs api errors 50 30m`** — 50 api staging errors from the last 30 minutes
- **`/logs 100 2h`** — 100 auth staging entries from the last 2 hours
- **`/logs map prod 10 7d`** — 10 map prod entries from the last week

**Custom gcloud filters (advanced):**

- **`/logs httpRequest.status>=500`** — Auth staging 5xx errors
- **`/logs api prod httpRequest.status>=400`** — Api prod 4xx+ errors
- **`/logs map httpRequest.requestMethod=POST`** — Map staging POST requests

**Supported time units:** `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks)

## Tested Configurations

The following app + environment combinations have been verified working:

| App    | Staging | Prod | Notes                                                                   |
| ------ | ------- | ---- | ----------------------------------------------------------------------- |
| `auth` | ✅      | ✅   | Primary use case — originally built for this app                        |
| `api`  | ✅      | ✅   | GCP project `f3-api-472214`, service names differ per env               |
| `map`  | ✅      | ✅   | GCP project `pin-mastery`, Cloud Run service is `f3-2` / `f3-2-staging` |

## Adding a New App

1. Add two lines to `apps.conf` (staging + prod) with the format: `APP:ENV:GCP_PROJECT:SERVICE_NAME:REGION`
2. Update the registered apps table and tested configurations table above
3. Test with `/logs <app>` and `/logs <app> prod` to verify both environments work
