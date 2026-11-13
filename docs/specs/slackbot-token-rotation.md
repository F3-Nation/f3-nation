# Slackbot token rotation

> Human designer: Moneyball (@evanpetzoldt)

## 1. Summary

The Slackbot's tokens for each Slack workspace expire every 12 hours and are
renewed automatically, so a leaked token stops working on its own. Each
workspace's credentials live in one place, the `slack_spaces` row, with the
refresh token encrypted. Python code reads tokens through one getter. Only
Python refreshes, one refresh per workspace at a time, and the TypeScript API
only reads. The architecture and its tradeoffs are in
[ADR 0005](../adr/0005-slack-official-token-rotation.md).

## 2. Context & links

- Apps affected: Slackbot service, Slackbot scheduled job, API, and the shared
  schema.
- Bolt app and OAuth settings: [`main.py`](../../apps/slackbot/main.py) and
  `get_oauth_settings` in
  [`helper_functions.py`](../../apps/slackbot/utilities/helper_functions.py).
  The per-request region lookup in the same file currently copies Bolt's
  `context["bot_token"]` into `slack_spaces`. That copy goes away.
- Token readers to migrate: every Python read of `bot_token` (from
  `SlackSettings`, `SlackSpace` or the settings JSON) in
  `apps/slackbot/features/` and `apps/slackbot/scripts/`, plus the DB Admin
  "Update Bot Token" action in
  [`db_admin.py`](../../apps/slackbot/features/db_admin.py). Find them with
  `grep -rn bot_token apps/slackbot --include=*.py`.
- API reader: `getSlackBotTokenForOrg` in
  [`slack.ts`](../../packages/api/src/router/slack.ts).
- Hourly job: [`hourly_runner.py`](../../apps/slackbot/scripts/hourly_runner.py),
  deployed as a Cloud Run Job by
  [`deploy-slackbot.yml`](../../.github/workflows/deploy-slackbot.yml).
- Schema: [Drizzle](../../packages/db/drizzle/schema.ts) and the Python models
  in `packages/db-python`. Follow the
  [db-migration skill](../../.agents/skills/db-migration/SKILL.md).
- Slack: [token rotation](https://docs.slack.dev/authentication/using-token-rotation),
  `oauth.v2.access` with `grant_type=refresh_token`, `oauth.v2.exchange`.
  `slack_sdk.oauth.token_rotation.TokenRotator` performs refreshes.
- Slack revocation behavior the design depends on is recorded in the ADR's
  Context section.

### Data model

`slack_spaces` stays one row per workspace (`team_id`) and gains the fields Bolt
needs to authorize and rotate. The exact column names are the builder's call:

- `bot_token`: the current access token, plaintext. Its meaning is unchanged
  for the API.
- The access token's expiry. Null means a long-lived, non-rotating token.
- The refresh token, encrypted. Null for non-rotating tokens.
- `bot_id`, `bot_user_id` and the bot scopes, so the store can rebuild Bolt's
  `Bot` object.

The `bot_token` key in the `settings` JSON is removed. Non-credential settings
in that JSON are preserved.

### Encryption

- Use `cryptography`'s `MultiFernet` (already a Slackbot dependency) with a
  dedicated key, `SLACK_TOKEN_ENCRYPTION_KEY`, separate from
  `PASSWORD_ENCRYPT_KEY`. The variable accepts a comma-separated list of keys,
  newest first, so a key can be replaced without downtime.
- The key is given to the Slackbot service and job only, never to the API.
- The refresh token is decrypted only inside the refresh procedure and the
  re-key CLI, which decrypts each row to re-encrypt it. No other function
  returns it, and no `Bot` handed to Bolt or to callers carries it.
- Changing the key: put the new key first in the list, keeping the old one
  second, and run the re-key CLI. It re-encrypts every row's refresh token with
  the newest key under the workspace lock, without calling Slack. Its check
  mode lists rows the newest key alone can't decrypt. The old key is removed
  only after the check finds none.
- `scripts/cloud-run-env.sh` refuses a value whose entries aren't Fernet keys
  before any cloud call, and never destroys earlier versions of the key's
  secret, so a key that rows were encrypted with stays recoverable.
- Adding the variable follows the env-var checklist in the root
  [`AGENTS.md`](../../AGENTS.md#dependencies-and-environment-variables).

### Refresh procedure

All refresh paths share one function:

1. Open a transaction and take
   `pg_advisory_xact_lock` on a key derived from the team ID, with a lock
   timeout.
2. Re-read the row. If the token no longer expires within the refresh window,
   another process already refreshed it, so return the stored token.
3. Otherwise call `TokenRotator` with the decrypted refresh token, write the
   new access token, expiry and encrypted refresh token, and commit. Committing
   releases the lock.
4. If the lock times out, re-read the row and return its token without
   refreshing.

Every write to the token fields, including the store's `save` after an OAuth
install, happens under the same lock. A write never replaces a token with one
that expires earlier, and never replaces a rotating token with one that has no
expiry. A stored token with no expiry never blocks a write, so an exchange or
reinstall always replaces it.

Where it runs:

- **Bolt requests.** Bolt runs in bot-only mode, so it looks installations up
  only through the store's `find_bot`. `find_bot` runs the procedure, then
  hands Bolt the access token without its expiry or refresh token. Bolt
  rotates only a `Bot` that carries a refresh token, so it treats every
  installation as non-rotating and its built-in, unlocked refresh never runs.
- **The getter**, for Python code outside Bolt's request context and for jobs.
- **The hourly sweep.**

Refresh windows: the store and the getter refresh tokens expiring within 2
hours. The hourly sweep refreshes tokens expiring within 3 hours. Refreshing a
token that isn't close to expiry revokes tokens in use for no gain, so no path
refreshes earlier than its window.

## 3. User stories

- As a region admin, my Slackbot keeps working with no reinstall when tokens
  start rotating.
- As an F3 tech maintainer, a token that leaks through a bug stops working
  within 12 hours without anyone acting.
- As an F3 tech maintainer, a copy of the database doesn't give whoever holds
  it lasting access to any workspace.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN a workspace row with a non-null expiry more than 2 hours
  away WHEN the getter is called THEN it returns the stored access token and
  makes no call to Slack.
- **AC-2** — GIVEN a workspace row whose token expires within 2 hours WHEN the
  getter or the store's lookup runs THEN it refreshes once and returns the new
  token. The row holds the new access token, the new expiry, and a refresh
  token that decrypts to Slack's new value.
- **AC-3** — GIVEN two processes that both find the same workspace's token
  near expiry WHEN they run the refresh procedure concurrently THEN Slack is
  called exactly once, and both return the token that was saved.
- **AC-4** — GIVEN a row holding a token that expires at time T WHEN any
  write offers a token that expires before T, or a token with no expiry, THEN
  the row is unchanged. GIVEN a row whose token has no expiry WHEN any write
  offers a token THEN the row holds the offered token.
- **AC-5** — GIVEN a row with a null expiry WHEN any path reads it THEN the
  stored token is used as-is and no refresh is attempted.
- **AC-6** — GIVEN a new installation or reinstall through Bolt's OAuth flow
  WHEN Slack returns a rotating token THEN the `slack_spaces` row for that team
  holds the access token, its expiry and the encrypted refresh token, and no
  token is written to the settings JSON or the GCS bucket.
- **AC-7** — GIVEN a stored refresh token WHEN the row is read with SQL THEN
  the column's value is not the plaintext token and decrypts to it with
  `SLACK_TOKEN_ENCRYPTION_KEY`. GIVEN that key's previous value is listed
  second THEN rows encrypted with it still decrypt, and the next refresh writes
  them with the first key.
- **AC-8** — GIVEN workspaces whose tokens expire within 3 hours WHEN the
  hourly job starts THEN each is refreshed before the job's other scripts run.
  A failure for one workspace is logged and does not stop the others or the
  rest of the job.
- **AC-9** — GIVEN a Slack call that fails with `token_revoked` WHEN it was
  made with a token from the getter THEN the caller re-reads the row and
  retries once with the token stored there. A second failure is raised.
- **AC-10** — GIVEN the TypeScript API sending a Slack message for a region
  WHEN the region's row has a valid token THEN the API uses
  `slack_spaces.bot_token`, makes no refresh call, and has no access to the
  encryption key.
- **AC-11** — GIVEN the API's Slack call fails with `token_revoked` WHEN it
  used `slack_spaces.bot_token` THEN the API re-reads the row and retries once
  with the stored token. A second failure is reported as today.
- **AC-12** — GIVEN a rotating row WHEN DB Admin "Update Bot Token" is used
  THEN the row is unchanged and the admin is told to reinstall the app. GIVEN
  a non-rotating row THEN the action behaves as before.
- **AC-13** — GIVEN a non-rotating row WHEN the conversion CLI runs for that
  team THEN it calls `oauth.v2.exchange` under the per-workspace lock and
  saves the access token, expiry and encrypted refresh token. GIVEN a row that
  is already rotating THEN the CLI skips it. GIVEN an exchange failure THEN the
  row is unchanged and the failure is printed by team ID. GIVEN Slack answers
  `token_already_exchanged`, or the exchange succeeds but the save still fails
  after retries, THEN the CLI prints that team as needing a reinstall, never
  calls the exchange again for it, and exits non-zero. GIVEN the exchange call
  fails with an error that isn't a Slack API error (such as a dropped
  connection) THEN the CLI prints that team as `error:<exception class>` and
  exits non-zero; Slack may or may not have exchanged the token, so a re-run
  for that team either converts it or reports it as needing a reinstall.
- **AC-14** — GIVEN any Slackbot code path WHEN it builds a Slack client for a
  workspace other than the one in Bolt's request context THEN the client comes
  from the token module, and the calling code never holds the token string. No token is read from the settings JSON, stored in a
  module-level cache, written to Slack metadata or logged. A test fails if any
  Slackbot source file outside the token module reads a `bot_token` attribute
  or key, or calls the getter directly.
- **AC-15** — GIVEN local development (`LOCAL_DEVELOPMENT`) WHEN the Slackbot
  starts THEN it runs with a single long-lived token and no OAuth store, as it
  does today, and the getter returns that token.
- **AC-16** — GIVEN the hourly sweep WHEN the encryption key is missing or
  can't decrypt a row THEN the job fails that workspace with a logged error
  and does not overwrite the row.
- **AC-17** — GIVEN `ADMIN_TEAM_ID` names a workspace with a `slack_spaces`
  row WHEN the connection-request flow notifies admins in `ADMIN_CHANNEL_ID`
  THEN the token comes from the getter for that team. `ADMIN_BOT_TOKEN` no
  longer exists. GIVEN `ADMIN_TEAM_ID` is unset or has no row THEN no admin
  notification is sent and `slack.token.admin_team_missing` is logged; the
  rest of the connection-request flow continues as it does today when admin
  notifications aren't configured.
- **AC-18** — GIVEN a rotating row WHEN Bolt authorizes a request for that
  workspace THEN the `Bot` the store returns has no expiry and no refresh
  token, and Bolt makes no refresh call and no `save_bot` call of its own.
- **AC-19** — GIVEN `SLACK_TOKEN_ENCRYPTION_KEY` lists a new key before the
  old one WHEN the re-key CLI runs THEN every row's refresh token decrypts with
  the new key alone, no Slack call is made, and the access tokens are
  unchanged. GIVEN a row the newest key alone can't decrypt WHEN the CLI runs
  in check mode THEN it prints that team ID, writes nothing and exits
  non-zero.

## 5. Roles & authorization (RBAC)

This feature adds no user-facing procedures. Its authorization boundary is
which runtimes hold which secrets.

| Action                                   | Allowed                                                                                | Explicitly denied                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Decrypt a refresh token                  | Slackbot service and Slackbot job (hold `SLACK_TOKEN_ENCRYPTION_KEY`)                  | API, Next.js apps, local dev against shared DBs                                          |
| Refresh a token                          | Slackbot service (Bolt authorization, getter) and Slackbot job (getter, sweep)         | API                                                                                      |
| Read the current access token            | Slackbot service, Slackbot job, API (existing `slack_spaces` read)                     | Browser clients, Slack metadata, logs                                                    |
| Overwrite a workspace's token by hand    | DB Admin "Update Bot Token", behind `SECRET_ADMIN_PASSWORD`, on non-rotating rows only | Everyone, on a rotating row: the action refuses and tells the admin to reinstall the app |
| Convert a workspace to rotation          | Release owner, with the conversion CLI                                                 | Everyone else; the Slackbot service and job never convert                                |
| Re-encrypt refresh tokens with a new key | Release owner, with the re-key CLI                                                     | Everyone else                                                                            |

## 6. Out of scope / non-goals

- A token broker or token endpoint (see the ADR).
- Encrypting the access token, or `PASSWORD_ENCRYPT_KEY`-protected fields.
- Replacing Bolt's built-in OAuth callback or the GCS OAuth state store.
- User tokens, Enterprise Grid org-wide installs, and `SLACK_APP_TOKEN` and
  `SLACK_CLIENT_SECRET`, which are separate credentials.
- A Slack IP allowlist.
- Tooling to revoke a leaked refresh token. Recovery is revoking that
  workspace's tokens and reinstalling the app.
- Installer user tokens from the manifest's user scopes. They rotate too once
  rotation is on, but nothing reads them, so they aren't stored.

### Rollout constraints

Rotation can't be disabled on a Slack app, so the order is binding:

1. Every reader goes through the getter or the API's table read, and the
   custom store is live in production, while tokens are still long-lived
   (null expiry). The settings-JSON copy is gone and the GCS installation
   files have been imported into `slack_spaces`. The import never overwrites
   a rotating row, so running it again after conversion is safe.
   `ADMIN_TEAM_ID` has replaced `ADMIN_BOT_TOKEN` in every environment,
   because that token is a copy of the production app's token for the admin
   workspace and would be revoked by converting it.
2. The rotation path is exercised against a separate rotation-enabled test
   app, never the production or shared dev app.
3. Rotation is enabled on the staging app, its workspaces are converted with
   the conversion CLI, and staging runs on rotating tokens for at least a few
   days with no `slack.token.refresh_failed` events before production is
   touched. Staging has its own `SLACK_TOKEN_ENCRYPTION_KEY`.
4. Rotation is enabled on the production app, and existing workspaces are
   converted with the conversion CLI in batches, starting with one workspace
   the tech team uses. Workspaces not yet converted keep working as
   non-rotating rows. Conversion can't be undone for a workspace, and Slack
   exchanges a token only once, so a workspace whose exchange response is lost
   before it is saved, or whose rotating token breaks, recovers by
   reinstalling the app.

## 7. Critical-path test cases

- AC-3 against a real Postgres: two concurrent refreshes, one Slack call.
- AC-2 and AC-7 round trip: refresh, save, decrypt.
- AC-8: the sweep refreshes near-expiry rows and survives one failing workspace.
- AC-14: the static boundary test over Slackbot source.
- AC-18: Bolt's own authorizer, run against the store, never refreshes.
- AC-13: a lost exchange response is reported as needing a reinstall and is
  never retried. An exchange call that fails with a non-Slack error is
  reported as `error:<exception class>`, and a re-run reports the team as
  needing a reinstall or converts it.

## 8. Observability

Events through the Slackbot's logging helpers. They never include token
values, refresh tokens or key material, only the team ID.

- `slack.token.refreshed`: team ID, path (`authorize`, `getter`, `sweep`).
- `slack.token.refresh_failed`: team ID, path, Slack error code. Alert on any
  occurrence in the sweep.
- `slack.token.lock_timeout`: team ID, path.
- `slack.token.revoked_retry`: team ID, whether the retry succeeded.
- `slack.token.decrypt_failed`: team ID.
- `slack.token.admin_team_missing`: whether `ADMIN_TEAM_ID` is unset or has
  no row.
- `slack.token.encryption_key_invalid`: logged at ERROR when the app or the
  hourly job starts outside local development and `SLACK_TOKEN_ENCRYPTION_KEY`
  is unset or doesn't parse. No key material.
- `slack.token.install_refused`: team ID. An OAuth install's token was not
  saved because the stored rotating token expires later.
