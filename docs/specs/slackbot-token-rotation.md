# Slack bot token rotation

> Human designer: TBD; feature behavior and acceptance criteria accepted by the requestor on 2026-10-25.

> **Implementation remains gated.** Architecture B and the proposed acceptance
> criteria (including `HEALTH_HOLD`, ordering contention, and ambiguous-outcome
> recovery) were accepted by the requestor on 2026-10-25. Schema/migration,
> encryption/key policy, service authorization, and production rollout each
> require separate explicit human approval. No production action is authorized.

## 1. Summary

Move Slack bot installation credentials to one protected, database-authoritative
installation model that supports Slack token rotation. Bolt continues handling
events/listeners, while the application owns the OAuth install route, state
validation/atomic consume, Slack code exchange, verified identity checks,
installation model, and safe error handling. Bolt runtime authorization, Python
features/jobs, and TypeScript consumers use one DB-authoritative credential
provider. The goal is to stop stale-token failures and divergent credential
copies while protecting refresh tokens and proving old-token rejection. Feature
behavior and acceptance criteria are accepted; implementation and production
changes remain gated as described above.

## 2. Context & links

- App(s) affected: slackbot, api, and the deployment/runtime that serves
  Slackbot and its jobs.
- Pinned-source findings (Bolt Python 1.30.0 / slack-sdk 3.43.0):
  - [Bolt `App` constructor and authorization configuration](https://github.com/slackapi/bolt-python/blob/v1.30.0/slack_bolt/app/app.py)
  - [Bolt `OAuthSettings`](https://github.com/slackapi/bolt-python/blob/v1.30.0/slack_bolt/oauth/oauth_settings.py)
  - [Bolt `OAuthFlow`](https://github.com/slackapi/bolt-python/blob/v1.30.0/slack_bolt/oauth/oauth_flow.py)
  - [Bolt installation-store authorization](https://github.com/slackapi/bolt-python/blob/v1.30.0/slack_bolt/authorization/authorize.py)
  - [Python SDK token rotator](https://github.com/slackapi/python-slack-sdk/blob/v3.43.0/slack_sdk/oauth/token_rotation/rotator.py)
  - These pinned source links inform the draft, not a supported extension
    contract. Verify exact source behavior and supported APIs against the pinned
    dependencies during implementation review.
- Key code / consumers:
  - Bolt OAuth installation store and authorization setup:
    `apps/slackbot/utilities/helper_functions.py`.
  - Existing organization Slack credentials/settings and writes:
    `apps/slackbot/utilities/database/orm/__init__.py`,
    `apps/slackbot/features/connect.py`,
    `apps/slackbot/features/db_admin.py`, and
    `apps/slackbot/utilities/helper_functions.py`.
    The DB Admin “Update Bot Token” action is guarded by
    `SECRET_ADMIN_PASSWORD`; this does not establish per-workspace authorization
    and must not be treated as proof of it. **To verify:** its complete
    authorization boundary and who can invoke it.
  - Python feature handlers constructing raw `WebClient`s, including
    `apps/slackbot/features/downrange.py`,
    `apps/slackbot/features/backblast.py`,
    `apps/slackbot/features/canvas.py`,
    `apps/slackbot/features/calendar/nearby_events.py`, and
    `apps/slackbot/scripts/update_slack_users.py`.
  - Python scheduled jobs/scripts consuming settings or copied bot tokens,
    including `apps/slackbot/scripts/auto_preblast_send.py`,
    `apps/slackbot/scripts/backblast_reminders.py`,
    `apps/slackbot/scripts/preblast_reminders.py`,
    `apps/slackbot/scripts/home_region_nudge.py`,
    `apps/slackbot/scripts/f3versary_announcements.py`,
    `apps/slackbot/scripts/update_special_events.py`,
    `apps/slackbot/scripts/kotter_reports.py`,
    `apps/slackbot/scripts/calendar_images.py`,
    `apps/slackbot/scripts/q_lineups.py`,
    `apps/slackbot/scripts/monthly_reporting.py`, and
    `apps/slackbot/scripts/award_achievements.py`.
    These are examples, not an exhaustive list; scripts/jobs may consume
    settings-derived tokens and lack the GCS OAuth installation mount available
    to the service. **To verify:** each runtime's credential access and
    deployment identity before selecting the provider access path.
  - TypeScript API token lookup and Slack HTTP calls:
    `packages/api/src/router/slack.ts`.
  - Deployment and current volume-backed installation persistence:
    `.github/workflows/deploy-slackbot.yml`,
    `apps/slackbot/app_manifest.json`, and
    the `FileInstallationStore` setup in
    `apps/slackbot/utilities/helper_functions.py`.
  - Environment fallback/documentation to audit:
    `apps/slackbot/.env.example` and `apps/slackbot/README.md`.
    Distinguish bot installation credentials from the separate
    `SLACK_APP_TOKEN`, `ADMIN_BOT_TOKEN`, and `SLACK_CLIENT_SECRET`; these have
    different purposes and must not be conflated or removed as part of bot
    installation token migration. **To verify:** exact consumers and secret
    ownership for each.
- The current source describes a GCS-mounted `FileInstallationStore`, legacy
  bot-token copies in Slackbot database/settings JSON, and TypeScript access to
  the Slackspace token. A complete consumer inventory remains a pre-implementation
  task; the paths above are known examples, not proof of completeness.
  Slack settings JSON also carries unrelated configuration: any eventual
  credential cleanup must preserve noncredential settings and remove only
  credential fields after their consumers are migrated.
- Pinned-version finding: Bolt's built-in `InstallationStoreAuthorize` performs
  refresh outside the store, which has no stable documented lock/reload hook
  spanning remote refresh. Bolt 1.30.0 source permits
  `App(authorize=AuthorizeSubclassInstance, oauth_settings=OAuthSettings(custom_db_store))`:
  this retains built-in `OAuthFlow` while replacing runtime
  `InstallationStoreAuthorize`. This combination is undocumented and
  version-sensitive. A custom `InstallationStore` or CAS alone does not prevent
  duplicate remote refresh-token redemptions.
- A synthetic local PoC at `/tmp/opencode/test_slack_rotation_authorizer_poc.py`
  passed four tests: mocked valid callback saved refresh metadata, invalid
  OAuth state was rejected, and the custom request authorizer was selected.
  This is limited evidence only: it did not test real DB transactions,
  multi-process locking, complete middleware/callback dispatch, or production
  behavior. It is not a supported-SDK guarantee.
- Pinned Bolt 1.30.0 callback inspection found that the built-in callback does
  not pass verified OAuth transaction provenance to `InstallationStore.save`,
  and its install error path can log the authorization code. Therefore built-in
  callback plus store is not recommended for the required stale-callback
  ordering and secret-safe error handling. The application-owned callback must
  redact callback/exchange errors and never log the code, tokens, OAuth response
  bodies, or authorization headers.
- **To verify:** live production Slack app rotation configuration, installed
  workspace count, database data shape/quality, job and service identities,
  credential source precedence, and whether every listed consumer is currently
  enabled. Perform verification using the nonsecret procedure in section 4;
  never collect credential values.
- A locally named manifest (`apps/slackbot/app_manifest.json`) does not prove
  that it describes the live production Slack app. Confirm live app identity
  and configuration with an authorized human; do not infer or change them from
  the local manifest.

### Accepted architecture (implementation gated)

**Architecture B — application-owned OAuth callback and custom
authorization.** Bolt continues handling events/listeners. The application owns
the OAuth install/callback route and transaction model: generate and persist
state/nonce with a single-use transaction ID; validate callback and
atomically consume state before any Slack exchange; exchange the code; verify
the returned bot/user/team/enterprise identity and expected scopes; perform a
safe `auth.test` identity check; persist through the same DB-authoritative
installation provider; and return only a generic/redacted error on failure.
Configure `App(authorize=custom_callable)` with neither `oauth_settings` nor
`oauth_flow`. The custom callable, Python feature/job clients, and authenticated
TypeScript token lookup delegate to the same credential provider. Do not invoke
Bolt's built-in `TokenRotator` or leave an independent unlocked refresh path.

The credential model is scoped by installation epoch and credential kind
(bot/user); each kind has an independent generation and refresh/migration
attempt state. For each refresh or existing-token `oauth.v2.exchange`, use two
transactions and one execution owner. **T1:** acquire the credential row lock,
re-read and require `READY(epoch,g)`, write nonsecret
`ATTEMPTED(epoch,g,attempt_id,execution_owner)`, record the installation
mutation stamp, and COMMIT before any remote Slack call. Only after confirmed T1
commit may the same execution owner start T2. **T2:** reacquire the same target
row lock, validate unchanged epoch/generation, attempt ID, execution owner, and
`ATTEMPTED` state; fence stale workers; disable SDK/HTTP retries; invoke Slack
once while holding the target lock; then atomically persist the complete
returned credential set, attempt completion, `READY(g+1)`, and a new mutation
stamp and COMMIT before returning. The global ordering lock described below is
held only briefly inside local DB transactions, never across Slack network
calls.

If T1 commit outcome is uncertain, reconcile the database by attempt ID and do
not send unless the committed intent and ownership are confirmed. If T2 commit
outcome is uncertain, reconcile the database and never send/redeem again. A
process death after T1, lock loss with a possibly in-flight T2 request, an
ambiguous response, or remote success followed by store failure leaves
`ATTEMPTED` blocking all workers even if writing `QUARANTINED` itself fails; if
possible, persist `QUARANTINED`. No automatic retry or human reset to
`READY(epoch,g)` is allowed for an ambiguous generation. A known, definitive
Slack rejection follows a separately human-approved classified error policy.
Human-controlled recovery must establish a safe new generation/reinstall path
and preserve an audit record.

OAuth transactions have durable states `ISSUED -> CLAIMED -> COMMITTED`, with
terminal `REJECTED` or `QUARANTINED` outcomes. At transaction issuance, take
only a singleton transactional DB ordering-row lock, capture its committed
counter value as callback baseline `C`, and commit `ISSUED` plus `C` in the same
transaction. Do not take an installation lock before identity is trusted.
Missing state, invalid state, replay of an existing `CLAIMED`/`COMMITTED` state,
or expired state is rejected without mutating that existing transaction or any
healthy installation; only an eligible, previously unclaimed transaction may
be marked `REJECTED`.

Each installation mutation takes locks in this order: target installation /
credential row first, then briefly the singleton counter row; increment the
counter and write that target's `last_mutation` atomically in the same DB
transaction. Never hold the global ordering lock across a Slack call. The
callback must **commit** `ISSUED -> CLAIMED` with a unique exchange attempt ID
and execution owner before calling Slack. Reconcile an uncertain claim commit
before sending; only that original execution may exchange the code once, with
SDK/HTTP retries disabled. Process loss or ambiguity must not allow another
execution to redeem it. After that exchange, verify the returned
bot/user/team/enterprise identity, scopes, and safe `auth.test`, then derive the
target installation identity. In a separate DB transaction, callback publication acquires the
target/credential locks and checks the target's `last_mutation` against baseline
`C`; reject publication if a later target mutation exists, or if that target has
unresolved `ATTEMPTED`/`QUARANTINED` work. Do not use `installed_at`, local
timestamps, bare `nextval`, replicas, or client-supplied team ID as the ordering
authority. An unrelated installation mutation does not stale this callback.

Among competing callback transactions issued with the same baseline, the first
successful publication for a target wins: its mutation stamp makes other
callbacks stale. First-install identity uses a unique DB lock/key for the
verified installation identity. Retain uninstall tombstones; they advance the
installation epoch and block callback publication unless the new transaction
carries a specifically authorized reinstall intent. Callback transaction
`COMMITTED` and credential publication occur in the same DB transaction. The
counter orders only local DB publication, not remote Slack effects.

If a code exchange succeeds but callback publication is later rejected as
stale, put the verified affected installation into conservative `HEALTH_HOLD`
pending human reconciliation; the provider fails closed for that installation
while the hold is active. Do not auto-revoke any token or assume successful
`auth.test` proves the refresh chain is sound. If callback identity cannot be
verified, quarantine only that OAuth transaction and do not guess which
installation to hold. Human security/reliability owners must accept the
availability impact and remote-effect ordering model, including effects already
in flight when another mutation wins.

The OAuth code exchange necessarily precedes trusted team identity and cannot
be atomic with the DB transaction. DB locking cannot make remote Slack effects
exactly-once if lock ownership is lost during an in-flight request or a response
is lost. The durable intent/quarantine protocol prevents unsafe automatic
redemption. The requestor accepted this availability/recovery tradeoff; the
specific operational recovery procedure still requires security/reliability
approval.

**Architecture A is not recommended.** Built-in Bolt OAuth callback plus a
custom store/custom `Authorize` composition is undocumented and version-
sensitive; pinned callback findings show it does not carry verified transaction
provenance into `InstallationStore.save` and may log the OAuth code on errors.
Do not use that composition for this design. Human approval remains required
for schema/key policy, service authorization/RBAC, operational OAuth recovery,
and rollout. Acceptance of these criteria authorizes no production action.

## 3. User stories

- As an authorized Slackbot operator, I want to inventory installations and
  migration status without displaying credentials so that I can coordinate a
  controlled rollout.
- As a Slackbot runtime, I want to obtain a current installation token through
  the credential provider so that API calls continue after refresh-token
  rotation.
- As an authorized operator, I want failed exchanges and partial migrations to
  be recoverable per installation so that one failure does not force an
  unsafe app-wide rollback.
- As a TypeScript API consumer, I want an authenticated token lookup scoped to
  the required Slack installation so that it does not access legacy token
  copies or accept caller-selected credentials.

## 4. Acceptance criteria (testable, non-contradictory)

**The requestor accepted the criteria below on 2026-10-25.** Security storage,
service authorization, migration, and production operations remain separately
gated; acceptance is not blanket implementation authorization.

- **AC-1** — GIVEN an authorized operator runs the documented inventory
  procedure WHEN it completes THEN it reports installation identifiers,
  nonsecret rotation/configuration status, last-success/health state, and
  consumer/migration coverage without outputting token values, refresh tokens,
  OAuth response bodies, or credential-bearing settings.
- **AC-2** — GIVEN an unapproved or unauthenticated caller requests an
  installation token WHEN the provider/API lookup is attempted THEN the request
  is denied and no credential material is returned to that caller or logged.
  Approved runtime clients necessarily receive the raw access token in-process
  to call Slack; it must not be exported to users, persisted in client caches,
  or included in logs or diagnostics.
- **AC-3** — GIVEN an authorized service requests access for an installation
  WHEN the request succeeds THEN it obtains a current access token only for the
  installation derived from trusted server-side identity, and does not read
  GCS/JSON or a Slackspace bot-token field as a competing authority.
- **AC-4** — GIVEN a refresh-token generation is due for refresh and concurrent
  provider/authorization requests target the same credential WHEN refresh is
  exercised across processes THEN for both refresh and existing-token
  `oauth.v2.exchange`, T1 locks/re-reads `READY(epoch,g)`, persists nonsecret
  `ATTEMPTED(epoch,g,attempt_id,execution_owner)` plus mutation stamp, and
  COMMITs before any Slack call. Only after confirmed T1 commit may that owner
  run T2: reacquire the same target lock, validate epoch/g/attempt/owner/state,
  fence stale workers, disable SDK/HTTP retries, invoke Slack once while holding
  the lock, then atomically persist the complete credential set, attempt
  completion, `READY(g+1)`, and mutation stamp and COMMIT before returning.
  Uncertain T1/T2 commit outcomes are reconciled from the DB; never send/redeem
  again on uncertainty. Persisted `ATTEMPTED` blocks all workers even if a
  `QUARANTINED` update fails. Human recovery never resets an ambiguous old
  generation to `READY`. This does not guarantee exactly-once remote effects
  under lock loss/in-flight requests. Tests prove separate bot/user generations
  and no Bolt `TokenRotator` or unlocked runtime refresh. Human approval of this
  failure/recovery tradeoff is required.
- **AC-5** — GIVEN each of these operations is performed separately: (a) the
  application-owned OAuth authorization-code exchange, (b) `oauth.v2.exchange`
  for an existing long-lived token, (c) the first refresh that invalidates the
  exposed pre-rotation token, and (d) a subsequent refresh
  WHEN process death or a lost commit/remote response is injected at every T1,
  T2, Slack-call, and persistence boundary THEN refresh/migration never calls
  Slack before confirmed T1 commit; uncertain T1 commit is reconciled before any
  send; death after T1 leaves `ATTEMPTED` blocking retries; T2 validates
  epoch/generation/attempt/owner/state and sends once with SDK/HTTP retries
  disabled; and uncertain T2 commit is reconciled without another remote call.
  Only successful Slack response plus complete credential persistence commits
  `READY(g+1)`; no path assumes missing credentials were stored or overwrites a
  newer generation. Separately, OAuth state is claimed with a unique attempt
  and execution owner and **committed before** code exchange; an uncertain
  claim commit is reconciled before sending and SDK/HTTP retries are disabled.
  Process death or an ambiguous exchange blocks replay and another redemption.
  Callback `COMMITTED` is atomic with credential publication.
  Test authorization-code exchange loss, callback publication failure, competing
  callbacks, and stale publication. Invalid/missing/expired state and replay of
  existing `CLAIMED`/`COMMITTED` transactions rejects without mutating those
  transactions or healthy installation credentials; only eligible unclaimed
  transactions may be marked `REJECTED`.
- **AC-6** — GIVEN rotation is enabled for the isolated rehearsal Slack app
  WHEN each token lifecycle is tested THEN (a) the initial exchanged token is
  identified separately from (b) the first long-lived token exposed before
  rotation and (c) each later refreshed token; the expected `auth.test` result
  is recorded for each applicable token. Specifically, the first token after
  the first rotation succeeds and the exposed pre-rotation long-lived token is
  rejected by Slack after rotation. Preserve only nonsecret result,
  installation identifier, generation, timestamps, and evidence references;
  never preserve any token.
- **AC-7** — GIVEN a valid installation whose access token expires within 12
  hours WHEN it is used through each supported Python and TypeScript consumer
  THEN the provider refreshes it as needed and each consumer completes its
  representative Slack operation using the current token.
- **AC-8** — GIVEN refresh and OAuth install/reinstall transactions race WHEN
  concurrency and crash/retry scenarios run THEN OAuth state issuance locks
  only the singleton DB counter row, captures committed baseline `C` with
  `ISSUED`, and commits; every installation mutation locks target then briefly
  the counter, increments it, and atomically writes that target's
  `last_mutation`. Counter lock is never held across Slack. After verified
  identity, callback locks target/credentials and rejects if target mutation is
  newer than `C`, or unresolved `ATTEMPTED`/`QUARANTINED` exists, or a retained
  tombstone lacks specifically authorized reinstall. Unrelated target mutation
  does not stale this callback. Competing callbacks with same baseline have
  first-publication-wins semantics. First-install identity has a unique DB lock;
  uninstall retains tombstone and advances epoch. Callback `COMMITTED` and
  credential publication share one DB transaction. Tests prove operation
  ordering across multiple DB processes, and no local timestamps, bare
  `nextval`, replica, or client team ID is used for ordering/identity. A verified
  post-exchange stale callback puts the affected installation in `HEALTH_HOLD`
  for human reconciliation; the provider fails closed for that installation
  while held. No token is auto-revoked and `auth.test` is not treated as proof
  of refresh-chain integrity. If identity is unverified,
  quarantine only the OAuth transaction. Invalid/missing/expired/replayed state
  rejects without mutating existing `CLAIMED`/`COMMITTED` transaction or healthy
  credentials.
- **AC-9** — GIVEN a refresh is rejected, times out, or the stored credentials
  are invalid WHEN a consumer requests access THEN it fails closed without
  falling back to a stale token, reports a redacted actionable status, and
  leaves a documented reinstall/recovery path for an authorized operator.
- **AC-10** — GIVEN an installation has completed an authorized reinstall WHEN
  the new installation record is committed THEN the new credential version
  becomes authoritative and prior tokens are not returned by newly migrated
  consumers. Any existing clients, process caches, or already-issued tokens
  may remain usable until their own expiry/restart/re-authentication; the
  migration must document and bound that residual window, invalidate caches
  where supported, and must not claim immediate global revocation unless Slack
  confirms it.
- **AC-11** — GIVEN all old Python and TypeScript consumers in the reviewed
  inventory are migrated WHEN the legacy token columns/settings JSON and
  environment fallback are disabled or cleared under an approved migration
  plan THEN consumer tests and inventory checks show no reads/writes through
  those legacy paths, while unrelated settings JSON fields and the separate
  `SLACK_APP_TOKEN` and `SLACK_CLIENT_SECRET` remain intact unless independently
  reviewed and approved for change, and the authoritative protected record
  remains usable. `ADMIN_BOT_TOKEN` remains separate configuration rather than
  an installation-token alias; if it is a bot token for the same rotating Slack
  app, it is included in the nonsecret inventory and its lifecycle is reviewed
  separately before any change.
- **AC-12** — GIVEN the candidate change is deployed to an isolated staging
  service using a separate development Slack app WHEN the full rehearsal is
  run (application-owned OAuth route/state transaction; callback provenance;
  bot/user/enterprise identity and safe `auth.test`; `ATTEMPTED` durability and
  crash recovery; authorization-code exchange, existing long-lived-token
  `oauth.v2.exchange`, first refresh, and subsequent refresh; lost response and
  remote-success/store-failure for each remote operation; stale callback,
  reinstall, uninstall and refresh races; process death after T1; uncertain T2
  commit; callback during `ATTEMPTED`; competing callbacks; unrelated
  installation mutation; replay during `CLAIMED`/`COMMITTED`; and post-exchange
  stale-callback `HEALTH_HOLD`; unverified identity quarantining only the OAuth
  transaction; multi-process DB locking; old-token rejection; secret-safe error
  logging; and SDK middleware dispatch) THEN every result
  meets the approved runbook, no built-in OAuth callback or independent unlocked
  runtime refresh/credential copy is used, and no production app or installation
  is changed.
- **AC-13** — GIVEN any production rollout begins after all approvals WHEN a
  stop rule in section 6 is met THEN the rollout pauses new exchanges and
  migration batches, preserves per-installation status for diagnosis, and
  follows the human-approved recovery procedure without an automatic global
  rollback or stale-token fallback. Healthy already-migrated installations
  continue normal provider refresh so the stop does not itself cause avoidable
  outages; a separate human decision is required to suspend refresh for a
  specific safety incident.
- **AC-14** — GIVEN Bolt or slack-sdk is upgraded WHEN dependency changes are
  proposed THEN tests for the application-owned OAuth route and transaction
  state machine, `App(authorize=custom_callable)` middleware dispatch without
  `oauth_settings`/`oauth_flow`, bot/user/enterprise resolution, refresh locking,
  failures, reinstall, and uninstall run against the candidate version before
  deployment approval; a failing or unreviewed upgrade is blocked. Deployments
  may not mix versions/configurations that can invoke an unlocked runtime
  refresh or bypass callback/provider generation coordination.

## 5. Roles & authorization (RBAC)

The installation credential store and provider are service-to-service
interfaces, not user-facing token retrieval APIs. The exact service identities,
operator roles, authorization mechanism, and audit policy are **human-owned
security decisions and to verify**. The matrix below is a proposed default,
not approved RBAC.

| Action                                                         | Allowed                                                                                                                                                                    | Explicitly denied                                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Read installation inventory/status (nonsecret metadata only)   | Specifically authorized Slackbot/security operators and approved service identities, scoped to operational need                                                            | Unauthenticated users, ordinary users, and operators without the designated permission                                              |
| Resolve current access token for an installation               | Only the authenticated Slackbot credential provider/service identity; TypeScript may call only an authenticated, installation-scoped lookup with a server-derived identity | Browser/client callers, arbitrary API callers, callers supplying an unverified installation ID, and services lacking explicit grant |
| Write, refresh, replace, or revoke installation credentials    | Credential provider through the approved workflow; explicitly authorized operator for install/reinstall/recovery with an audited action                                    | Ordinary users, unrelated service identities, and any actor lacking the approved credential-management permission                   |
| Enable rotation on an app or migrate a production installation | Named human owner(s) after security/reliability and deployment approval, in approved batches                                                                               | AI agents, automation without an explicit human-approved gate, and operators not designated for the change                          |
| Use raw access token for Slack API calls                       | Approved runtime clients receive it in-process from the provider as required to call Slack                                                                                 | Browser/client callers, unrelated service identities, user-facing responses, persistent client caches, and any other purpose        |
| Read, export, or log refresh tokens or raw credential records  | Credential provider only, at minimum runtime scope                                                                                                                         | Inventory/reporting surfaces, application logs, test output, client bundles, repository contents, and support/chat transcripts      |

The existing `SECRET_ADMIN_PASSWORD` gate on DB Admin’s Update Bot Token action
is not, by itself, evidence that an actor is authorized for a particular Slack
workspace. The replacement/update flow must establish and test explicit
per-installation authorization; exact role mapping is **to verify** and requires
human approval.

## 6. Out of scope / non-goals

- No code, configuration, manifest, dependency, or database change in this
  draft; no production operation or live Slack API call.
- No GCS-mounted JSON/FileInstallationStore or settings JSON as a parallel
  authoritative credential store. The protected database installation record
  is the proposed single authority; approval and schema design remain pending.
- No assumption that Bolt's custom `InstallationStore` serializes refresh.
  SDK hook behavior and live-app details are explicitly **to verify**.
- No app-wide production toggle, automatic production credential exchange,
  or blanket rollback.
- No logging, inventory export, telemetry, fixture, or documentation containing
  raw tokens, secrets, PII, or raw OAuth account/response objects.
- No API that lets callers choose arbitrary installation credentials.
- No decision in this spec on encryption/key management, data retention,
  credential revocation, database migration shape, exact service identities,
  approved operator names, or final stop thresholds. These are human-owned
  security/reliability decisions.

### Proposed rollout and gates (four phases)

1. **Architecture B implementation after remaining approvals — no app toggle.**
   The requestor accepted this spec and its proposed failure model; human owners
   must separately approve security/RBAC/storage and migration choices before
   affected code or schema changes. Complete the
   nonsecret consumer audit. Preserve Bolt event/listener handling but implement
   the application-owned OAuth route, CSRF/state/nonce validation and atomic
   consume, code exchange, verified identity/scope checks, safe `auth.test`,
   installation model, callback provenance, and secret-safe errors. Configure
   `App(authorize=custom_callable)` without `oauth_settings` or `oauth_flow`.
   Implement the shared DB provider and durable state machines; use it for Bolt
   runtime authorization, Python features/jobs, and authenticated TypeScript
   lookup. Review the schema migration separately; it requires explicit human
   sign-off.
2. **Consumer migration — no app toggle.** Migrate every inventoried Python
   feature/job and TypeScript consumer to the provider. Remove legacy writers,
   readers, and caches only after coverage proves each consumer migrated;
   retain compatibility only as an explicitly bounded, non-authoritative
   transition and never as a stale-token fallback. Preserve unrelated settings
   JSON fields. Keep `SLACK_APP_TOKEN`, `ADMIN_BOT_TOKEN`, and
   `SLACK_CLIENT_SECRET` separate from bot installation token migration. Gate
   on explicit per-installation/cross-workspace authorization, no stale-token
   use, complete inventory reconciliation, and removal or disablement of every
   independent unlocked Bolt runtime refresh and credential-copy path. Existing
   issued tokens and
   caches may survive until expiry or cache invalidation; document that bounded
   exposure rather than promise immediate invalidation.
3. **Isolated staging rehearsal — no production app toggle.** Use a separate
   development Slack app and staging service/jobs. Require real application-
   owned OAuth route and Bolt middleware dispatch; verify bot/user/enterprise
   resolution, callback transaction provenance, multi-process DB locking,
   callback/refresh/reinstall/uninstall races, the dependency-upgrade gate, and
   no mixed-version deployment. Rehearse code exchange, existing
   long-lived-token `oauth.v2.exchange`, first refresh that invalidates the
   exposed token, subsequent refresh, expiry within 12 hours, process death
   after durable `ATTEMPTED`, lost responses and remote-success/store-failure
   for each remote operation, state replay/expiry, and old-token rejection via
   Slack `auth.test`. Confirm no raw OAuth code or credential appears in logs.
   Record redacted evidence and recovery steps. Human reviews evidence and
   explicitly approves production readiness.
4. **Human-owned production toggle and batches.** Only designated humans may
   enable rotation on the live app and start per-installation exchange. Record
   a nonsecret ledger per installation, verify first refresh and old-token
   rejection, proceed by approved canary then batches, and pause on any stop
   rule. Do not deploy mixed versions/configurations that can bypass the
   provider lock or callback generation protocol. No production action is
   delegated to an agent without explicit human authorization.

### Nonsecret inventory procedure

Before implementation and again before rollout, an authorized operator should
run a read-only audit against source/configuration and the appropriate
nonsecret installation metadata. Do not dump database rows or settings blobs.
Report only installation/team identifiers as approved for the report,
credential source category, credential version/presence flags, rotation-enabled
and expiry/health timestamps where available, consumer ownership, and migration
status. Inventory `ADMIN_BOT_TOKEN` as a distinct configuration; if it belongs
to the same rotating app, track it separately as a potential bot-token consumer
and obtain human review before changing it. Do not select, print, hash for
distribution, or export access tokens, refresh tokens, OAuth responses, authorization headers, or serialized settings
containing credentials. Restrict report access and retention. Independently
reconcile the inventory with service/job deployment definitions and source
search for token reads/writes and `WebClient` construction; record reviewed
paths and uncovered questions. **To verify:** exact safe DB fields, production
inventory access, live installation identities/count, and report access
controls. Confirm which jobs lack access to the GCS OAuth mount and how each
will authenticate to the provider before rollout. Verify live production app
identity independently; a local-named app manifest is not proof of production
configuration. Treat the DB Admin password gate as distinct from
per-installation authorization and include its authorization audit in the
inventory evidence.

### Deployment stop rules and recovery

The following are proposed stop conditions; humans must approve numeric
thresholds and the incident owner before rollout. A refresh or existing-token
migration intent must be durably `ATTEMPTED` before Slack is called. After
process death, lock loss with a possibly in-flight request, ambiguous refresh or
migration response, or remote success/store failure, preserve the blocking
`ATTEMPTED` state or persist `QUARANTINED`; block all further redemption for
that credential generation and require human-controlled recovery. An ambiguous
OAuth code-exchange response or callback publication failure quarantines that
OAuth transaction and blocks code replay. Invalid/missing/expired OAuth state
and replay of an existing `CLAIMED`/`COMMITTED` transaction are rejected without
mutating that transaction or existing credentials; only eligible unclaimed
transactions may be marked `REJECTED`.
Disable new production exchanges and migration batches if any installation
cannot establish a known committed credential version, refresh concurrency
violates the per-generation redemption rule, the new token fails expected Slack
validation, the old token is not rejected where expected, any consumer uses a
legacy/stale fallback, an unexplained API failure/permission regression occurs,
or logs/inventory expose credential material. Do not blindly retry an
ambiguous single-use operation. If a verified callback exchanged credentials
but loses publication ordering to a later mutation, set that installation to
`HEALTH_HOLD`, fail closed pending human reconciliation, and do not auto-revoke
tokens or infer refresh-chain integrity from `auth.test`. If identity cannot be
verified, quarantine only the callback transaction. A human owner controls
recovery, reinstall, revocation, or any broader suspension. A rollout stop does not stop healthy
migrated installations from normal provider refresh; suspending those refreshes
requires a separate human incident decision. Existing clients/caches may
continue using already-issued access tokens until expiry or invalidation, so
record and bound that residual exposure. No automated app-wide rollback is
specified.

## 7. Critical-path test cases

- For refresh and existing-token migration, inject T1 death before/after commit
  and reconcile uncertain T1 outcomes; no Slack call occurs without confirmed
  committed intent. Inject T2 death, lost response, and uncertain commit; verify
  one call with SDK/HTTP retries disabled, re-read/reconcile without a second
  call, and durable `ATTEMPTED`/`QUARANTINED` blocking the old generation.
- Refresh-token redemption is counted per bot/user credential generation; a
  concurrent race initiates at most one redemption while lock ownership is
  valid, while an ambiguous/lost-lock outcome quarantines that generation and
  blocks another attempt. A different installation refreshes independently.
- The app-owned OAuth callback claims `ISSUED -> CLAIMED` before code exchange;
  valid success and publication becomes `COMMITTED`, definitive failure
  `REJECTED`, and ambiguous exchange/publication `QUARANTINED`. Invalid, expired,
  or replayed state rejects only the transaction, without touching existing
  credentials. Verify callback transaction provenance, derive trusted identity
  only from Slack's verified result and `auth.test`, and never select an
  installation from client-supplied team identity.
- Kill the callback after Slack accepts the code exchange but before
  publication: the committed claim survives, and neither replay nor recovery
  issues another exchange. Reconcile uncertain claim commits before sending.
- Refresh and existing-token migration intent transitions durably
  `READY(g) -> ATTEMPTED(g)` before Slack invocation and only confirmed remote
  success plus credential persistence advances to `READY(g+1)`;
  ambiguous/dead-worker/store-failure state blocks retry until human recovery.
  Exercise separate bot/user generations and stale
  callback rejection after a newer refresh, reinstall, or uninstall using
  operation ordering, epoch, generation, and tombstone fencing—not `installed_at`
  or client-time heuristics.
- For each of (1) application-owned authorization-code exchange, (2) existing
  long-lived-token `oauth.v2.exchange`, (3) first refresh invalidating the
  exposed token, and (4) subsequent refresh, inject process death/lost response
  and remote-success/store-failure separately. Verify durable intent, correct
  `REJECTED` versus `QUARANTINED` outcome, no blind retry, no stale overwrite,
  secret-safe error logging, and human recovery.
- Provider refresh, OAuth callback, reinstall, and uninstall races verify
  callback provenance/order fencing, installation epoch/tombstone updates,
  separate bot/user generations, stale-write prevention, and old-token/cache
  behavior with multiple DB-connected processes.
- Exercise callbacks competing with the same baseline (first publication wins),
  callback during unresolved `ATTEMPTED`, unrelated-installation mutation
  (must not stale callback), callback stale after target mutation, and retained
  tombstone without/with specifically authorized reinstall. Replay while state
  is `CLAIMED` or `COMMITTED` must reject without mutating that record. A
  verified post-exchange stale callback enters fail-closed `HEALTH_HOLD` pending
  human reconciliation without automatic revocation; unverified identity
  quarantines only the OAuth transaction. Confirm `auth.test` alone does not
  release the hold or establish refresh-chain integrity.
- Each inventoried Python and TypeScript consumer uses the provider and cannot
  fall back to a legacy token source.
- Isolated staging rehearsal proves refresh (including token expiry within 12
  hours), successful `auth.test` with the first refreshed token, rejection of
  the old token, and reinstall/failure recovery.
- Unauthorized token lookup and all inventory/logging paths disclose no
  credential material.
- Application-owned OAuth error paths never log authorization codes, OAuth
  state/nonce, access/refresh tokens, response bodies, or authorization headers;
  invalid state leaves an existing installation unchanged.

## 8. Observability

- Emit structured, redacted events using repository logging conventions
  (Python Slackbot's existing logging path and `@acme/logger` for TypeScript)
  for installation lookup,
  refresh started/succeeded/failed, CAS or lock contention, credential-version
  commit, exchange/commit ambiguity, reinstall/recovery state, and rollout
  pause. Include only approved nonsecret installation identifiers, version,
  outcome, and timing/status metadata.
- Never log authorization codes, OAuth state/nonce, access/refresh tokens,
  token prefixes, authorization headers, request/response bodies, raw SDK
  installation objects, or settings blobs.
- Metrics should expose counts, latency, contention, failure classes, and
  version transitions without credential material or unnecessary personal
  data. Define alert thresholds and retention with the human security and
  reliability owners before rollout.
- Record old-token rejection and staging rehearsal as redacted evidence; never
  store token values in the ledger.
