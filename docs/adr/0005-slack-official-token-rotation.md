# ADR 0005: Slack bot token rotation with the official SDK

- **Date:** 2026-11-11
- **Author(s):** @evanpetzoldt

## Context

The Slackbot is installed in many Slack workspaces. Each installation gives a
bot token (`xoxb-…`) that, without rotation, never expires: a token that leaks
works until someone reinstalls the app or revokes it by hand. Tokens have
leaked through application bugs before, for example by being placed in Slack
modal metadata that round-trips through the user's Slack client.

Today each workspace's token exists in several places that drift apart:

- Bolt's OAuth installation store, a `FileInstallationStore` on a GCS bucket
  mounted only into the Slackbot service.
- `slack_spaces.bot_token`, which the TypeScript API reads to post to Slack,
  and which some Python features and scheduled jobs also read directly.
- A `bot_token` key inside the `slack_spaces.settings` JSON, which other
  Python features and scheduled jobs read. The service copies the token from
  Bolt's request context into both columns when it sees a different one.

Slack offers [token rotation](https://docs.slack.dev/authentication/using-token-rotation):
access tokens expire after 12 hours and are renewed with a refresh token. Bolt
for Python refreshes tokens inside its request authorization, and `slack_sdk`
ships a standalone `TokenRotator`. Rotation cannot be turned off once it is
enabled on a Slack app.

Behavior observed against a rotation-enabled test app on 2026-11-11, which the
design depends on:

- Every refresh returns a new access token and a new refresh token.
- A refresh token keeps working after it has been used, including after a
  newer refresh token has been issued from it.
- Using a refresh token can revoke access tokens issued by earlier refreshes
  (`token_revoked`), including one another process is still using. Two
  concurrent refreshes of one workspace both succeed, and a later refresh
  revoked both of their access tokens.

So refreshes that aren't serialized can leave a revoked token saved as the
current one, and a stolen refresh token stays useful for a long time.

## Decision

**Enable Slack token rotation using Bolt's and `slack_sdk`'s official rotation
support, keep every credential in the existing `slack_spaces` row.**

- **One store, one row per workspace.** A custom Bolt `InstallationStore`
  backed by `slack_spaces` replaces the GCS `FileInstallationStore`. The row
  holds the current access token, its expiry, and the refresh token. No other
  copy of a token is kept: not in the settings JSON, in-memory caches, Slack
  metadata, or the GCS bucket.
- **The refresh token is encrypted at rest** with a dedicated key held in
  Secret Manager and given only to the Slackbot service and its scheduled job.
  The access token stays plaintext: it is valid for at most 12 hours, and
  keeping it plaintext lets the TypeScript API read it without the key.
- **Python reads tokens through one getter**, which takes the workspace's team
  ID. Python features, Bolt handlers that build their own `WebClient`, and
  scheduled jobs all use it.
- **Only Python refreshes, one refresh per workspace at a time.** Refreshes
  happen in the store's lookup, which Bolt calls on every request, in the
  getter when a token is near expiry, and in a sweep at the start of the
  existing hourly job. Every refresh runs in one database transaction that
  takes a per-workspace transaction-level advisory lock
  (`pg_advisory_xact_lock`), re-reads the row, refreshes only if the token is
  still near expiry, and saves before the transaction commits and releases the
  lock. The refresh itself uses `slack_sdk`'s `TokenRotator`. Bolt never
  refreshes: the store hands Bolt the access token without its expiry or
  refresh token, so Bolt treats the installation as non-rotating and its
  built-in rotation never runs. Saves never replace a token with one that
  expires earlier. A token with no expiry never blocks a save, so an exchange
  or reinstall always replaces it.
- **The TypeScript API only reads.** It reads `slack_spaces.bot_token` as it
  does today and never refreshes. On `token_revoked` it re-reads the row and
  retries once. The hourly sweep keeps quiet workspaces'
  tokens fresh, so the API never depends on the Slackbot service being up.
- **Rotation is the last step.** Before rotation is enabled on the production
  app, every reader goes through the getter or the API's table read, and the
  same code runs against long-lived tokens. A token with no expiry is treated
  as non-rotating. Existing installations are then moved to rotating tokens
  with Slack's `oauth.v2.exchange`, without users having to reinstall. Slack
  exchanges a token only once (`token_already_exchanged`), so if an exchange's
  response is lost before it is saved, that workspace has to reinstall the app.

## Alternatives considered

**A separate token broker service** that owns OAuth, encryption and refresh,
and hands short-lived tokens to the Slackbot, jobs and API over authenticated
service-to-service calls. It gives the strongest isolation, but it adds a
service to deploy and monitor, and the whole bot goes down when the broker
does. Rejected for a volunteer-run team.

**A token endpoint on the existing Slackbot service** for the API to call. It
would put a token-dispensing endpoint on an internet-facing service. Its
authentication would have to span two GCP projects, and the API would stop
working whenever the Slackbot is down. Reading the shared table gives the API
the same access it already has.

**The SDK's `SQLAlchemyInstallationStore`.** It is official, but it keeps
tokens in its own tables, so `slack_spaces` would still need a synchronized
copy for the API and jobs. It also can't encrypt the refresh token, and it
expects to create its own schema, which `packages/db` owns through Drizzle.

**No locking, last write wins.** Rejected because of the observed revocation
behavior: an unserialized refresh can leave a revoked token saved as current,
and Bolt wouldn't refresh it again until it neared expiry.

**Encryption and guardrails without rotation.** Leaked access tokens would
stay valid indefinitely.

**A Slack IP allowlist** ("Restrict API token usage"). It makes a leaked token
useless from anywhere else, but it needs static egress IPs for both GCP
projects, and a change to them breaks the bot. It can be added later on top of
rotation.

## Consequences

**Better:**

- A leaked access token stops working within 12 hours, sooner if a refresh
  revokes it.
- A copy of the database exposes no usable refresh tokens, and access tokens
  that expire within 12 hours.
- One authoritative token per workspace, so readers no longer drift apart. The
  GCS installation bucket and its mount are retired.
- No new services. Refresh runs in code that already runs: Bolt request
  handling and the hourly job.

**Accepted risks and costs:**

- **Rotation is irreversible.** If refresh breaks for more than about 12
  hours, every workspace's bot stops working until it is fixed. The hourly
  sweep starts refreshing well before expiry so that one failed run doesn't
  cause an outage, and failures are logged and alerted on.
- **A code path that keeps its own copy of a token breaks within 12 hours.**
  Any copy outside `slack_spaces` is a bug. Tests and review must catch new
  ones.
- **In-flight calls can hit `token_revoked`** when another process refreshes
  the same workspace. Python readers and the TypeScript API re-read the row
  and retry once.
- **A leaked refresh token stays useful for a long time.** Rotation narrows
  where it can leak rather than removing the risk: the refresh token is
  encrypted at rest and is only ever decrypted inside the Slackbot's refresh
  code. It never reaches the API, Slack metadata, the settings JSON or the GCS
  bucket, which are the paths access tokens have leaked through. Recovering
  from a leaked refresh token means revoking that workspace's tokens and
  reinstalling.
- **The encryption key is a new secret to manage.** Losing it makes every
  refresh token unreadable, so every workspace would have to reinstall.
  A key change re-encrypts every row's refresh token with the new key under
  the workspace lock, without calling Slack, and the old key is retired only
  after a check finds no row still encrypted with it.
- **Anyone who can read the database and the Slackbot's secrets can still mint
  tokens.** Encryption protects database dumps, backups and snapshots, not a
  compromised Slackbot runtime.
- Bolt's built-in OAuth callback and the GCS OAuth state store are unchanged.
