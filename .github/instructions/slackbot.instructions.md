---
applyTo: "apps/slackbot/**"
---

# Slack bot (`apps/slackbot`)

Deploys independently of the TypeScript apps. Python conventions are in
`python.instructions.md`.

## Slack platform rules

- Treat a message `ts` as an opaque string; never round-trip it through
  `float`.
- Call `ack()` before opening a loading modal, and make no blocking HTTP calls
  before `views.open`: `trigger_id` expires in seconds.
- Read pickers by type, never `value`: `datepicker` -> `selected_date`,
  `timepicker` -> `selected_time`. Keep the three state parsers
  (`extract_state_values`, `sdk_orm.py`, `orm.py`) in sync.
- Respect Block Kit limits: 100 blocks per modal, 50 per message; section text
  3,000 characters; option labels 75; keep `text` fallback <= 4,000 (the
  recommended cap; Slack truncates at 40,000).
- For posted messages, on `invalid_blocks`, `msg_blocks_too_long` or
  `msg_too_long` fall back to plain
  `text`.
- Never pass `None` to `set_initial_values`; omit the key. Deep-copy shared
  form/element instances before mutating them.
- Escape user- and org-supplied text before putting it in mrkdwn, so
  `<!channel>` and `<@U…>` are neutralized.
- Handle slash-command payloads (`body.user_id`) as well as interactive ones.

## Reliability

- Headless paths (cron, auto-preblast, `scripts/`) must not call view-update
  helpers.
- Surface failed Slack or API writes to the user (ephemeral or error view);
  never log and then report success.
- Never hold a DB row lock across a Slack API call.
- API-client updates read prior state first and raise if it is missing or
  mismatched. Clear a field only through an explicit flag, never by omission.
- Re-validate the selected id at submit (exists, active, in this region); don't
  trust modal options built earlier.
- Update `slack_spaces.settings` with targeted writes, not a whole-blob
  read-modify-write (`region_record.__dict__` overwrite).

## Data and privacy

- Outside production, users created by the bot get the staging email sink
  address and no phone number.
- Don't email or announce on behalf of an existing user using data someone
  else typed.
- Shared constants live in `utilities/constants.py`.
- Register new interactions in `utilities/routing.py`; shared action ids go in
  `utilities/slack/actions.py`.
- Bug-fix tests drive the real handler with a raw `view.state.values` payload
  rather than patching the parser.
