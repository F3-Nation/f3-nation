# F3 Nation Slack Bot

[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

F3 Nation Slack Bot runs inside the monorepo and now follows the same local workflow as the other apps.

## Local development (monorepo)

### Prerequisites

1. Docker running locally
2. Node and pnpm installed for the monorepo
3. `uv` available for Python dependency/runtime management

### One-time setup

From the repo root:

```bash
pnpm local:setup
```

This creates `apps/slackbot/.env` from `apps/slackbot/.env.local.example`, then starts shared Docker services and runs DB migration/seed steps.

### Configure Slack credentials

Edit `apps/slackbot/.env` and set at minimum:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN` (required for Socket Mode)

### Start all local apps

From the repo root:

```bash
pnpm dev
```

Slackbot starts automatically with the rest of the workspace apps.

- Slackbot local URL: http://localhost:3006
- Connection mode: Socket Mode only (no localtunnel)

## Slack app manifest workflow

At startup, `app_startup.sh` regenerates `app_manifest.json` from `app_manifest.template.json`.

1. Start dev (`pnpm dev`) so `app_manifest.json` is generated.
2. In Slack app settings, open **App Manifest**.
3. Replace the manifest with `apps/slackbot/app_manifest.json`.
4. Save and reinstall if prompted.

The generated manifest enables Socket Mode and removes slash command URLs that are only needed for tunnel-based HTTP event delivery.

## Step debugging

1. Set `ENABLE_DEBUGGING=true` in `apps/slackbot/.env`.
2. Start dev with `pnpm dev`.
3. Attach VS Code debugger to `debugpy` on port `5678`.

## Scripts

Run from `apps/slackbot`:

```bash
pnpm dev
pnpm test
pnpm lint
```

## Codebase notes

- `main.py`: app entrypoint and Slack event handling
- `utilities/routing.py`: request/action routing map
- `utilities/slack/actions.py`: shared action/callback constants
- `features/`: feature handlers and UI building logic
- `utilities/slack/orm.py`: legacy custom Slack UI helper layer

Data access currently uses SQLAlchemy/f3-data-models (`packages/db-python`) while API migration work continues.
