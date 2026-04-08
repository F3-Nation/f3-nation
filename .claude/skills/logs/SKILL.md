---
name: logs
description: Query Cloud Run logs for any monorepo app. Use when the user wants to check service logs, errors, or request patterns in staging or prod.
metadata:
  version: "3.0.0"
  argument-hint: "[app] [prod|staging] [errors|warnings] [count] [timerange]"
---

# Cloud Run Logs

Query Cloud Run logs for any app in this monorepo. Defaults to **auth** on **staging** if no app is specified.

## Registered Apps

See `apps.conf` for the full registry. Currently:

| App    | Staging Project               | Prod Project         | Region       |
| ------ | ----------------------------- | -------------------- | ------------ |
| `auth` | `f3-authentication-staging`   | `f3-authentication`  | `us-east1`   |
| `api`  | `f3-api-472214`               | `f3-api-472214`      | `us-central1`|
| `map`  | `pin-mastery`                 | `pin-mastery`        | `us-central1`|

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

- **`/logs`** — 20 most recent auth staging entries
- **`/logs api`** — 20 most recent api staging entries
- **`/logs map prod`** — 20 most recent map prod entries
- **`/logs auth prod errors 1h`** — Auth prod errors from the last hour
- **`/logs api errors 50 30m`** — 50 api staging errors from the last 30 minutes
- **`/logs map httpRequest.status>=500`** — Map staging 5xx errors

## Adding a New App

1. Add two lines to `apps.conf` (staging + prod) with the format: `APP:ENV:GCP_PROJECT:SERVICE_NAME:REGION`
2. Update the table above
