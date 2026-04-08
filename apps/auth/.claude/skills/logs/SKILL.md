---
name: logs
description: Query Cloud Run logs for the f3-auth deployment. Use when the user wants to check auth service logs, errors, or request patterns in staging or prod.
metadata:
  version: "2.0.0"
  argument-hint: "[prod|staging] [errors|warnings] [count] [timerange]"
---

# F3 Auth — Cloud Run Logs

Query Cloud Run logs for the **f3-auth** deployment.

## Environment Map

| Environment | GCP Project                 | URL                                  |
| ----------- | --------------------------- | ------------------------------------ |
| `staging`   | `f3-authentication-staging` | `https://staging.auth2.f3nation.com` |
| `prod`      | `f3-authentication`         | `https://auth2.f3nation.com`         |

- **Cloud Run Service:** `f3-auth` (same in both environments)
- **Region:** `us-east1`

## Instructions

When the user runs this skill, use the helper scripts in `scripts/` to fetch and format logs. Pass through all user arguments verbatim.

### Step 1 — Fetch logs

Run the fetch script with the user's arguments:

```bash
bash apps/auth/.claude/skills/logs/scripts/fetch-logs.sh $ARGS > /tmp/f3-auth-logs.json
```

The script handles all argument parsing (environment, severity, time range, limit, custom filters) and writes JSON to stdout. Metadata (env, project, limit, filter) is printed to stderr.

### Step 2 — Format and display

Pipe the JSON through the format script:

```bash
cat /tmp/f3-auth-logs.json | bash apps/auth/.claude/skills/logs/scripts/format-logs.sh
```

This produces a markdown table with columns: Timestamp, Severity, Method + URL, Status, Latency, Remote IP — plus a summary footer with counts and status code breakdown.

### Step 3 — Follow up

If there are errors, offer to dig deeper into specific log entries by their `insertId`.

### Examples

- **`/logs`** → 20 most recent staging entries
- **`/logs prod`** → 20 most recent prod entries
- **`/logs errors 1h`** → Staging errors from the last hour
- **`/logs prod errors 50 30m`** → 50 prod errors from the last 30 minutes
- **`/logs httpRequest.status>=500`** → Staging 5xx errors
