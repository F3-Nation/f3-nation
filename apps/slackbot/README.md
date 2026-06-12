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

## Deployment

Slackbot deploys via tag-based GitHub Actions, similar to the other monorepo apps.

### Release trigger

- Tag format: `slackbot@MAJOR.MINOR.PATCH` (example: `slackbot@1.14.0`)
- Trigger workflow: `.github/workflows/deploy-slackbot.yml`

### What deploys

One tag deploys two runtimes:

1. Main app as Cloud Run service
2. Scripts workload as Cloud Run Job (for scheduler-driven runs)

### Environments and runtime targets

- GitHub environments: `slackbot-staging`, `slackbot-production`
- GCP project: `f3slackbot`
- Region: `us-central1`
- Main service (both stages via reusable workflow): `f3-nation-slack-bot`
- Scripts job (staging): `f3-bot-scripts-test`
- Scripts job (prod): `f3-bot-scripts-prod`

### Flow

1. Push `slackbot@X.Y.Z` tag
2. Workflow waits for CI checks on that commit (`build`, `lint`, `typecheck`, `format-check`, `test-coverage`)
3. Builds and pushes staging images
4. Deploys staging main service and staging scripts job
5. Waits for production environment approval
6. Promotes images and deploys production service and production job
