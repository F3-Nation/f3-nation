# Slack Integration

## Overview

Slack Bot notifications for `/api/ingest` (daily data ingest cron). No other Slack integrations exist in the app layer — the data warehouse has `slack_spaces`, `slack_users`, and `orgs_x_slack_spaces` tables but those are read-only from this repo's perspective.

## Mechanism

- `sendSlackNotification(message: string)` in `src/app/api/ingest/route.ts` (private helper, not exported)
- Calls `https://slack.com/api/chat.postMessage` with Bearer token auth
- Gracefully no-ops if env vars missing; logs errors but never throws

## Env Vars

- `SLACK_BOT_AUTH_TOKEN` — Bot OAuth token (`xoxb-...`)
- `SLACK_CHANNEL_ID` — Target channel ID (`C0123456789`)

## When Notifications Fire

All three ingest outcomes send a Slack message:

1. **Skipped/noop** (idempotency check, <20h since last run): `:hourglass_flowing_sand:` prefix
2. **Success**: `:white_check_mark:` prefix, includes ISO timestamp
3. **Failure**: `:x:` prefix, includes error string

## Data Warehouse Slack Tables (read-only context)

- `slack_spaces` — workspace metadata (team_id, workspace_name, bot tokens)
- `slack_users` — user profiles (slack_id, user_name, email, admin/owner/bot flags, strava tokens)
- `orgs_x_slack_spaces` — maps F3 orgs to Slack workspaces
- Schema: `drizzle/f3-data-warehouse/schema.ts`
- These tables are not queried by this app; they exist in the warehouse DB
