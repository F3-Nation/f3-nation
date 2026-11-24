# Moving bot features onto the F3 API

Parts of the Slack bot still change shared F3 data (users, attendance, event
instances, regions, achievements) by writing to the database directly through
`DbManager` and SQLAlchemy. Each of those writes is moving to the F3 API, so
that every app applies one copy of each rule, the same permission checks and
the same audit history, and so that a bug in the bot can't change shared data
directly.

This guide covers the rules for that work and the steps for moving one
feature. How the bot calls the API, where the API's contract lives, and how
to run against a local API are in [API_REFERENCE.md](API_REFERENCE.md).

## Rules

- **The bot never writes shared tables directly.** Every change to shared F3
  data goes through an API endpoint. The bot keeps direct write access only
  to tables holding Slack-only state: Slack workspaces, Slack accounts, the
  link between an org and its workspace, and the `slackbot` schema, listed
  in `BOT_OWNED_TABLES` and `BOT_OWNED_SCHEMA` in `utilities/constants.py`.
  A test in `tests/test_shared_table_writes.py` fails when a file's count
  of detected direct writes to any other table differs from its baseline
  file, which lists the writes still to move and shrinks as each one moves
  to the API. It doesn't see a write made by changing an attribute on a
  loaded record and committing. When the
  bot keeps its own Slack bookkeeping (a dismissed reminder, a posted
  message's timestamp, where a message was cross-posted) in the `meta` column
  of a shared row, that state moves to a bot-owned table, not to the API. A
  value a person entered about themselves or their region is F3 data and
  goes through the API.
- **The rules move with the data.** When the bot decides something about F3
  data (whether it's valid, who's eligible, who's due a reminder), that
  decision moves into the API with tests. The bot keeps only rendering Slack
  views and delivering messages. A rule left in the bot drifts from the same
  rule in the map, admin and future apps.
- **Every new or extended endpoint ships with the bot using it.** Add the
  endpoint and switch the bot to it in the same change, so the API never
  carries an endpoint that real use hasn't proven.
- **New code calls the API from a plain function.** Don't add new
  data-model, protocol, service or repository layers. The domains already
  built with those layers (under `application/` and
  `infrastructure/api_client/*_repository.py`) stay as they are: extend them
  in place when a change touches them, and don't refactor them away as part
  of unrelated work.
- **Behavior stays the same.** Moving a feature onto the API changes where
  data is written, not what the user sees. A behavior fix found along the way
  is a separate change.
- **One user action, one transaction.** When a single action changes several
  tables (a backblast and its attendance, say), the bot calls one endpoint
  that commits all of it or none of it, rather than a sequence of calls that
  can stop halfway.

Slack's timing and payload limits apply to every API call the bot makes from
a handler. They are in
[the bot's Slack platform rules](../AGENTS.md#slack-platform-rules); in
particular, make no blocking API call before `views.open`.

## Moving one feature

### Find what the API already offers

Read the operation in the API's OpenAPI spec or the router source (see
[where the contract lives](API_REFERENCE.md#where-the-contract-lives)). Check:

- the request schema and the response schema separately, since a field can
  have different names going in and coming out;
- the operation's description, which states cascades (deleting a series also
  removes its future instances) and whether a delete is soft or hard. Don't
  repeat in the bot a cascade the API already performs;
- the role the operation requires, and whether the bot's API key has it.

Don't infer a path or envelope key from another domain: paths, envelope keys
and list filters differ between domains.

### Add or extend the endpoint if needed

If the API can't do what the bot does today, change the router in
`packages/api` first: the endpoint, the rule it now owns, and tests for that
rule. Write behavior the schema can't show (cascades, hard deletes, side
effects) into the operation's description so it reaches the spec. Follow
[the repository conventions](../../../AGENTS.md) and
[the secure-coding guide](../../../docs/AI_DEVELOPMENT_GUIDE.md).

### Call it from a plain function

Write a function that makes the call and returns what the API sent. Put it
in the feature module that uses it, and move it to a shared module only when
a second feature needs it.

```python
from infrastructure.api_client.client import get_f3_api_client
from infrastructure.api_client.pagination import fetch_all_pages


def list_region_locations(region_id: int) -> list[dict]:
    """Every active location in the region, as the API returns them."""
    return fetch_all_pages(
        get_f3_api_client(),
        "/v1/location",
        {"regionIds": [region_id], "statuses": ["active"]},
        items_key="locations",
    )
```

Handlers read the response's own field names. If several call sites need the
same reshaping, write a small helper next to the function rather than a
data-model class.

### Switch the handler

Replace the direct database call with the function. Keep the handler's
inputs, outputs and messages the same. When an edit form doesn't show every
field the update needs, read the current record first and send its values
back unchanged; [the bot's reliability rules](../AGENTS.md#reliability-and-data)
say how updates read prior state and surface failures.

API ids are F3 ids, not Slack ids. Map a Slack user to an F3 user with
`get_user` in `utilities/helper_functions.py`, and map F3 user ids back to
Slack ids from the cached Slack users, filtered to the current workspace.
`get_user` isn't read-only: when a Slack account has no linked F3 user, it
creates one through SQLAlchemy, in every environment. That is one of the
bot's remaining direct writes to a shared table. When identity creation moves
to the API, change `get_user` itself, not the handlers that call it.

### Test it

- Test the function by patching `get_f3_api_client` where the function's
  module imports it, and assert on the path and parameters it sends.
- Test the handler by patching the function, driving it with a raw Slack
  payload as [the bot's AGENTS.md](../AGENTS.md#reliability-and-data)
  describes.
- Test the rule itself in `packages/api`, next to the router, not in the
  bot.

Run the bot's checks from the repository root:

```bash
pnpm lint --filter=f3-slackbot
```

```bash
pnpm test --filter=f3-slackbot
```

```bash
pnpm typecheck --filter=f3-slackbot
```

### Try it against a local API

Run the bot against the API from your own checkout, so the bot change and any
endpoint change are exercised together. See
[running against a local API](API_REFERENCE.md#running-against-a-local-api).
