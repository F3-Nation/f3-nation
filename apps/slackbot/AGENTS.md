# apps/slackbot

`apps/slackbot` is a Python app. Follow Python conventions: use `snake_case` for
modules, files, functions, and variables, and use pytest for tests. Name test
files `test_*.py` and test functions `test_*` so pytest discovers them. These
app-specific conventions take precedence over the repository's general
TypeScript/Vitest test filename guidance; do not rename Python tests to
`*.test.ts[x]`.

## Python conventions (all Python packages)

These also apply to `apps/analytics` and `packages/db-python`.

- Ruff owns lint and format; each package configures it in its own
  `pyproject.toml` (the root has none), and its 120-column limit is real.
- Tasks run through `scripts/python-task.sh`: it skips when `uv` is missing
  locally and fails in CI.
- Dependencies are managed with uv; a dependency, `requires-python` or
  version change in a `pyproject.toml` also changes `uv.lock`.
- A Python bump updates every pin together and never downgrades:
  `.python-version` (root and `apps/slackbot`), `requires-python` in every
  `pyproject.toml`, mypy `python_version`, the Dockerfile base images and
  `uv.lock`.
- In best-effort batches where items are independent (each recipient, org or
  region), catch, log and continue so one failure doesn't stop the batch.
  Inside one shared DB transaction, let errors propagate (or isolate each item
  with a savepoint); a caught DB error leaves the transaction aborted.
- Never log emails, names, phone numbers or credentials.
- Use `is not None` when `0` or `""` is a meaningful value.

## Slack platform rules

The bot deploys independently of the TypeScript apps and calls the API over
HTTP.

- Treat a message `ts` as an opaque string; never round-trip it through
  `float`. The exception is `event_instances.preblast_ts` / `backblast_ts`,
  stored as `double precision`: format them back with six decimals
  (`f"{ts:.6f}"`) before passing them to Slack.
- Call `ack()` before opening a loading modal, and make no blocking HTTP calls
  before `views.open`: `trigger_id` expires in seconds.
- Read pickers by type, never `value`: `datepicker` → `selected_date`,
  `timepicker` → `selected_time`. Keep the three state parsers
  (`extract_state_values`, `sdk_orm.py`, `orm.py`) in sync.
- Respect Block Kit limits: 100 blocks per modal, 50 per message; section text
  3,000 characters; option labels 75; keep `text` fallback ≤ 4,000 (Slack's
  recommended cap; it truncates at 40,000). For posted messages, fall back to
  plain `text` on `invalid_blocks`, `msg_blocks_too_long` or `msg_too_long`.
- Never pass `None` to `set_initial_values` (omit the key), and deep-copy
  shared form or element instances before mutating them.
- Escape user- and org-supplied text before putting it in mrkdwn, so
  `<!channel>` and `<@U…>` are neutralized.
- Handle slash-command payloads (`body.user_id`) as well as interactive ones.

## Reliability and data

- Headless paths (cron, auto-preblast, `scripts/`) never call view-update
  helpers.
- Surface failed Slack or API writes to the user (ephemeral or error view);
  never log and then report success.
- Never hold a DB row lock across a Slack API call.
- API-client updates read prior state first and raise if it's missing or
  mismatched. Clear a field only through an explicit flag, never by omission.
- Re-validate the selected id at submit (exists, active, in this region);
  don't trust modal options built earlier.
- Update `slack_spaces.settings` with targeted writes, not a whole-blob
  read-modify-write.
- Outside production, users the bot creates get the staging email sink
  address and no phone number. Don't email or announce on behalf of an
  existing user using data someone else typed.
- Shared constants live in `utilities/constants.py`. Register new interactions
  in `utilities/routing.py`; shared action ids go in
  `utilities/slack/actions.py`.
- Bug-fix tests drive the real handler with a raw `view.state.values` payload
  rather than patching the parser.
