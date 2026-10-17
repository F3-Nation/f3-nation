# F3 Nation Slack Bot

[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

F3 Nation Slack Bot runs inside the monorepo and now follows the same local workflow as the the other apps.

## Local development (monorepo)

### One-time setup

From the repo root:

```bash
pnpm local:setup
```

This creates `apps/slackbot/.env` from [`.env.example`](.env.example), then starts shared Docker services and runs DB migration/seed steps.

### Local email

Shared notification emails use `EMAIL_SERVER` and `EMAIL_FROM` from the Slackbot
env file. The local defaults send to Mailpit at `smtp://localhost:1025`, with
sender `F3 Nation <no-reply@f3local.dev>`. `pnpm local:setup --slot N` rewrites
the SMTP port for that checkout. Open Mailpit at `http://localhost:8025`, or at
the checkout's `F3_MAILPIT_UI_PORT` from the root `.env`, to inspect captured
messages. Existing checkouts should add these two variables to their local env
file; setup recreates env files, so preserve any existing local settings before
running it again.

The compatibility helper `send_via_sendgrid` now sends through SMTP and does not
use `SENDGRID_API_KEY`. An explicit `from_email` argument overrides `EMAIL_FROM`;
without either, the historical sender `noreply@f3nation.com` remains the fallback.
Region-configured backblast email keeps its separate SMTP settings.

Synthetic delivery through this helper can be tested without a Slack app.
End-to-end `/fng` delivery also needs the pending FNG command changes; direct
helper delivery does not verify that slash-command flow.

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

### SMTP configuration and rollout prerequisite

Before deploying an image that uses the shared SMTP helper, a release operator
must provision the complete `EMAIL_SERVER` URL as the `email-server` secret in
both `f3-slackbot-staging` and `f3-slackbot`. Grant the service and scripts-job
runtime accounts access, bind that secret as `EMAIL_SERVER`, and set the plain
`EMAIL_FROM` variable to a provider-approved sender for both runtimes. The tag
release workflow deploys images; it does not provision these SMTP settings.

Use [`.env.cloud-run.example`](.env.cloud-run.example) for the per-environment
configuration. The operator-run [`scripts/cloud-run-env.sh`](scripts/cloud-run-env.sh)
maps `EMAIL_SERVER` to Secret Manager and applies `EMAIL_FROM` as a plain env
variable to both the service and job. Keep SMTP URLs out of logs and command
arguments: they can contain credentials. Percent-encode reserved characters in
the URL username and password. For SendGrid SMTP, use `smtp.sendgrid.net:587`,
the literal username `apikey`, and the SendGrid API key as the percent-encoded
password, as shown in the cloud env example.

`smtp://` uses verified STARTTLS for remote servers; `smtps://` uses implicit TLS
with certificate verification. Plain SMTP is allowed only for unauthenticated
loopback endpoints such as local Mailpit. Authenticated loopback endpoints also
require TLS. An SMTP connection has a 10-second timeout. Missing configuration
or failed delivery returns `False`; there is no SendGrid API fallback.

Apply the SMTP settings before deploying the new image, retaining the existing
`SENDGRID_API_KEY` binding so the old image can continue sending during the
transition. The env script stops managing that old binding but does not remove
it or delete the old Secret Manager secret. After deployment, verify delivery
through the configured provider in Staging and Production, then retire the old
binding separately when rollback requirements allow. Local Mailpit delivery and
stubbed deployment tests do not verify provider authentication, sender approval,
or Cloud Run egress. These configuration and delivery checks are separate release
actions; changing the example files does not configure live resources.

### Production profile-privacy rollout

The regular release workflow passes `SLACKBOT_ENV=staging` and
`SLACKBOT_ENV=production` in the deploy flags for the matching staging and
production service and job. For production, the classification is applied
with the image deployment, so the privacy image is not deployed unclassified.
For a manual or other out-of-workflow deployment, first backfill the current
production service and job with `SLACKBOT_ENV=production`, then explicitly
include that variable on the deployment of the privacy image. Editing an env
file does not update existing Cloud Run resources or revisions.

Use these commands to backfill both current production resources before a
manual/out-of-workflow privacy deployment or rollback deployment:

```bash
gcloud run services update f3-slackbot --project=f3-slackbot --region=us-central1 \
  --update-env-vars=SLACKBOT_ENV=production
gcloud run jobs update f3-slackbot-scripts --project=f3-slackbot --region=us-central1 \
  --update-env-vars=SLACKBOT_ENV=production
```

After a manual deployment or backfill, inspect the service with
`gcloud run services describe f3-slackbot --project=f3-slackbot --region=us-central1`
and confirm the revision receiving traffic has
`SLACKBOT_ENV=production`; inspect `gcloud run jobs describe
f3-slackbot-scripts --project=f3-slackbot --region=us-central1` and confirm its
job template has the same value. Include `SLACKBOT_ENV=production` explicitly
in the rollback deployment when redeploying an older image. Do not route traffic
to an older immutable service revision or run an older job template unless it
has been confirmed to already contain the production classification; updating
the current service or job does not retrofit older revisions/templates. These
are operator-run commands for manual changes/rollback, not an automated
cleanup. The app does not automatically delete synthetic users or clean up
historical profile data.
