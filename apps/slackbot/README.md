# F3 Nation Slack Bot

[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

F3 Nation Slack Bot runs inside the monorepo and now follows the same local workflow as the the other apps.

## Local development (monorepo)

### One-time setup

From the repo root:

```bash
pnpm local:setup
```

This creates `apps/slackbot/.env` from `apps/slackbot/.env.local.example`, then starts shared Docker services and runs DB migration/seed steps.

### Create Slack app and configure Slack credentials

1. **Initialize and install your local Slack app**: I recommend you use your own private Slack workspace for this.
2. Open [Slack's app console](https://api.slack.com/apps), click Create New App->from manifest, then paste in the contents from `app_manifest.json`. Hit Save Changes at the top. You'll get a warning at the top asking you to verify the URL. Ignore it.
3. After you install to your workspace, gather the Signing Secret from the Basic Information tab and the Bot User OAuth Token from the OAuth & Permissions tab. For the app-level token, you will need to generate this from the Basic Information tab (when asked, assign it the `connections:write` scope).
4. **Copy to `.env`**: edit `apps/slackbot/.env` and set:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`

### Start the local apps with Slackbot

In the app manifest, there is a setting called socket_mode_enabled that is set to true. This tells Slack to connect to the app locally on your machine (port 3006).

From the repo root:

```bash
pnpm dev --include-py
```

Slackbot is opt-in for root dev startup because it needs the Python environment and Slack credentials. At the very least, you will need to also run the API app.

- Slackbot local URL: http://localhost:3006

### Uploading Files (NOT IMPLEMENTED)

Slackbot allows you to upload user avatar images and region logos. Right now the file upload functionality does not work when running the app locally. Maybe on day.

### First steps

Once the app is running, you will want to take some admin actions to make it useful.

1. Use the `/f3-nation-settings` slash command
2. You should see a button for `Migration Settings` which is present for Slack spaces that haven't yet been connected to a region
3. Open the menu, then search for a seeded region (F3 Charlotte is one that is seeded by default). You will be automatically "approved" when in local development.
4. I would recommend that you set channels for preblasts and backblasts. You can do that by either:
   1. Going to `/f3-nation-settings` -> `Backblast & Preblast Settings` and setting for your whole space
   2. Setting them individually by AO by going to `/f3-nation-settings` -> `Calendar Management` -> `Manage AOs` -> `Edit` and setting the channel for each

## Step debugging

1. Set `ENABLE_DEBUGGING=true` in `apps/slackbot/.env`.
2. Start dev with `pnpm dev --include-py`.
3. Attach VS Code debugger to `debugpy` on port `5678`.

## Scripts

Run from `apps/slackbot`:

```bash
pnpm dev
pnpm test
pnpm lint
```

### Testing reporting scripts locally

Scripts like `scripts/weekly_reporting.py`, `scripts/monthly_reporting.py`, and
`scripts/award_achievements.py` query the `event_instance_expanded` /
`attendance_expanded` materialized views, which exist in the cloud databases but
are not created by the local Drizzle migrations. To run them against local data:

```bash
# one-time: create local versions of the views (re-run to refresh after seeding)
docker exec -i f3-postgres psql -U f3local -d f3nation < apps/slackbot/scripts/sql/local-expanded-views.sql

# print a region's weekly report without sending anything to Slack
cd apps/slackbot
uv run python scripts/weekly_reporting.py --org-id <region_org_id> --dry-run
```

`--dry-run` prints the fully rendered report to stdout (it also works for a
region that has no Slack workspace connected yet). Drop `--dry-run` to actually
send using the region's saved reporting settings, or use the "Send Weekly Report
Now" button in `/f3-nation-settings` → Reporting Settings.

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
- GCP projects: `f3-slackbot-staging` and `f3-slackbot`
- Region: `us-central1`
- Main service (both stages via reusable workflow): `f3-slackbot`
- Scripts job (both stages via reusable workflow): `f3-slackbot-scripts`

### Flow

1. Push `slackbot@X.Y.Z` tag
2. Workflow waits for CI checks on that commit (`build`, `lint`, `typecheck`, `format-check`, `test-coverage`)
3. Builds and pushes staging images
4. Deploys staging main service and staging scripts job
5. Waits for production environment approval
6. Promotes images and deploys production service and production job
