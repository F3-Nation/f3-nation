# Calling the F3 API from the bot

How the Slack bot talks to the F3 API: where to find what the API offers, the
client the bot uses, and how to run the bot against a local API. The rules
for moving a feature onto the API are in [API_MIGRATION.md](API_MIGRATION.md).

## Where the contract lives

The API publishes its own OpenAPI spec, generated from the router, so it
can't drift from what the API does:

- **Spec:** `/docs/openapi.json` on any API host, for example
  `https://api.f3nation.com/docs/openapi.json`, or
  `$F3_API_BASE_URL/docs/openapi.json` for the API the bot is configured to
  use.
- **Interactive docs:** `/docs` on the same host.
- **Source:** the routers in [`packages/api/src/router/`](../../../packages/api/src/router/).
  Each procedure's input and output schemas, and its `description`, are what
  the spec is built from.

Read paths, parameters, envelope keys and field names there. This folder
doesn't copy them, because a copy goes stale the next time an endpoint
changes.

## The client

`get_f3_api_client()` in
[`infrastructure/api_client/client.py`](../infrastructure/api_client/client.py)
returns one shared client per process, so every call reuses the same
connection pool. It sends the API key and the bot's client name on every
request, and reads its configuration from the environment:

- `F3_API_KEY`: the bot's API key. The client won't start without it, and
  the key's role decides which operations succeed.
- `F3_API_BASE_URL`: which API to call. Unset, it calls production.

The client raises the exceptions in
[`exceptions.py`](../infrastructure/api_client/exceptions.py) instead of
returning error responses. Catch `F3ApiNotFoundError` where a missing record
is an expected outcome. Other errors must reach the user, as
[the bot's reliability rules](../AGENTS.md#reliability-and-data) require,
never a log line followed by a success message.

### Lists

A list request without `pageIndex` or `pageSize` returns only the first page,
not every matching row. When the bot needs every row, use `fetch_all_pages`
in [`pagination.py`](../infrastructure/api_client/pagination.py), whose page
size must stay equal to the API's maximum.

## Running against a local API

`pnpm local:setup` creates `apps/slackbot/.env` from
[`.env.example`](../.env.example), which points `F3_API_BASE_URL` at the local
API and sets `F3_API_KEY` to the key the local seed data creates for the bot.
Start the API alongside the bot from the repository root:

```bash
pnpm dev --include-py
```

Check that the API the bot is configured for answers by requesting
`/v1/ping` on the `F3_API_BASE_URL` in `apps/slackbot/.env`; it needs no key.
On the default ports:

```bash
curl http://localhost:3001/v1/ping
```

**Slotted checkouts.** In a second checkout or worktree set up with
`pnpm local:setup --slot N`, every port moves up by 100 × N, and setup
rewrites `F3_API_BASE_URL` in the bot's `.env` to that slot's API port. The
bot then calls its own checkout's API and database rather than the main
checkout's. See
[running several checkouts at once](../../../docs/LOCAL_DEV_DOCKER.md#running-several-checkouts-at-once-git-worktrees).

`local:setup` replaces `apps/slackbot/.env` each time it runs and keeps the
previous file as `.env.bak.<timestamp>`, so copy your Slack credentials back
from the backup afterwards. The Slack app setup itself is in the
[bot's README](../README.md).
