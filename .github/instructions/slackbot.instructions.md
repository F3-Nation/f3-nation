---
applyTo: "apps/slackbot/**"
---

# Slack bot (`apps/slackbot`)

The bot shares the database and API with the TypeScript apps, but it deploys
independently. Python conventions are in `python.instructions.md`.

## Slack platform rules

- Treat a message `ts` as an opaque string; never round-trip it through
  `float`.
- Call `ack()` before opening a loading modal. Never make several blocking
  HTTP calls before `views.open`, because the `trigger_id` expires in seconds.
- Read pickers by type:
  - `datepicker` → `selected_date`.
  - `timepicker` → `selected_time`.
  - `datetimepicker` → `selected_date_time`.
  - Never read `value`.
  - Keep all state parsers in sync.
- Respect Block Kit limits:
  - At most 100 blocks per modal and 50 per message.
  - Section text up to 3,000 characters; option labels up to 75 characters;
    `text` fallback up to 4,000 characters.
  - `data_table` / `raw_text` cells must be non-empty.
  - On `invalid_blocks` or `msg_too_long`, fall back to plain text.
- Never pass `None` to `set_initial_values`; omit the key. Deep-copy shared
  element instances before mutating them.
- Escape user- and org-supplied text before putting it in mrkdwn, so
  `<!channel>` and `<@U…>` are neutralized.
- Handle slash-command payload shapes (`body.user_id`) as well as interactive
  ones.

## Reliability

- Headless paths (cron, auto-preblast, `scripts/`) must not call view-update
  helpers or assume a `logger` argument.
- Failed Slack or API writes are surfaced to the user (ephemeral or error
  view), never just logged before reporting success.
- Never hold a DB row lock across a Slack API call.
- The API client must not send a cleared field when the prior-state read
  failed. It clears only the specific value it manages and preserves the
  rest.
- Re-validate the selected id at submit (exists, active, in this region).
  Don't trust modal options built earlier.
- Store per-region settings in `slack_spaces.settings`, and write targeted
  updates rather than whole-blob read-modify-write.

## Data and privacy

- Outside production, users created by the bot get the staging email sink
  address and no phone number.
- Don't email or announce on behalf of an existing user using data someone
  else typed.
- Shared constants live in `utilities/constants.py`.
- Register new interactions in `utilities/routing.py`, with action ids in
  `utilities/slack/actions.py`.
- Bug-fix tests drive the real handler with a raw `view.state.values` payload
  rather than patching the parser.
