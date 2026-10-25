# ADR 0005: Proposed Slack token broker and credential authority

- **Status:** Proposed — human security/reliability review required; not accepted
- **Date:** 2026-10-25
- **Author(s):** TBD (human owner)

## Context

Slack bot credentials are used by several separately deployed parts of the
system. The Slackbot public Cloud Run service and its scheduled job run in the
Slackbot project; the TypeScript API is deployed in a separate project. Today,
credential access is spread across plaintext `slack_spaces.bot_token`,
`settings.bot_token`, and Bolt's GCS-mounted installation store. Python raw
`WebClient` consumers and the API can read copied/stale tokens, and jobs do not
share the service's OAuth installation mount. Current grants also include broad
secret access and `F3_API_KEY` paths rather than a dedicated broker identity.
There is no general KMS envelope-encryption framework in the repository; the
legacy Fernet password-key scheme is not an adequate credential-protection
design. The live Slack app identity/configuration and complete production
inventory still require authorized human verification.

Known paths to reconcile include:

- Slackbot OAuth setup, service authorization, and GCS installation store:
  `apps/slackbot/utilities/helper_functions.py`.
- Plaintext token/settings model and writes:
  `apps/slackbot/utilities/database/orm/__init__.py`,
  `apps/slackbot/features/connect.py`, and
  `apps/slackbot/features/db_admin.py`.
- Python feature and job consumers: `apps/slackbot/features/` and
  `apps/slackbot/scripts/` (the inventory in the feature spec lists known
  examples and is not yet proven complete).
- TypeScript Slack token lookup and API calls:
  `packages/api/src/router/slack.ts`.
- Current Slackbot deployment and manifest:
  `.github/workflows/deploy-slackbot.yml` and
  `apps/slackbot/app_manifest.json`; the local manifest does not prove live
  production app identity.
- Drizzle database ownership/migrations: `packages/db/`; all schema DDL and
  migration work requires explicit human approval.

The feature behavior and acceptance criteria are in the human-accepted
[Slack token rotation spec](../specs/slackbot-token-rotation.md). That spec is
the source of truth for OAuth callback ordering, `ATTEMPTED`/`QUARANTINED`
handling, mutation ordering, stale callback fencing, `HEALTH_HOLD`, and tests.
This ADR proposes the deployment and trust boundaries for that design; it does
not grant permission to implement it.

Relevant official documentation:

- [Cloud Run service-to-service authentication](https://cloud.google.com/run/docs/authenticating/service-to-service)
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity)
- [Cloud Run access control](https://cloud.google.com/run/docs/securing/managing-access)
- [Cloud KMS envelope encryption](https://cloud.google.com/kms/docs/envelope-encryption)
- [Cloud KMS encrypt and decrypt](https://cloud.google.com/kms/docs/encrypt-decrypt)
- [Slack OAuth v2](https://api.slack.com/authentication/oauth-v2)
- [Slack token rotation](https://docs.slack.dev/authentication/using-token-rotation)

## Decision

**Proposed: operate a separate IAM-authenticated Python token broker service as
the sole credential and refresh authority.** The broker may use the Slackbot
image, but it is a distinct Cloud Run service with a distinct service account,
ingress policy, scaling/availability settings, and secret/KMS permissions. It
is not the public Slackbot service. The proposed project placement and exact
resource names remain human decisions.

The broker owns OAuth state and transaction storage, Slack authorization-code
exchange, identity/scope verification, safe `auth.test`, installation
publication, credential encryption/decryption, refresh/migration attempts,
recovery and audit records. It uses the state machines and DB ordering in the
feature spec. Bolt continues to handle events/listeners in the public Slackbot
service, configured with a custom authorization callable and no built-in OAuth
flow. The public service is only the browser/Slack ingress adapter: it forwards
OAuth start/callback requests to the broker over authenticated service-to-service
Cloud Run calls, returns the broker's safe redirect/response, and does not
exchange codes, persist credentials, or log callback query/body values. Browser
CSRF/state validation is enforced by the broker; IAM authentication of the
adapter-to-broker call is not a substitute for that browser protection, nor does
IAM make the public ingress network-private.

Python Slackbot runtime, Python jobs, and TypeScript API request only an
installation-scoped, short-lived **access token** from the broker. The broker
does not return refresh tokens or persistent credential records. Approved
runtime callers necessarily receive a raw access token in process memory to
call Slack; it must not be logged, exported to users, persisted in client
caches, or accepted for an arbitrary caller-selected team. The broker does not
proxy ordinary Slack API traffic in this proposal.

### Service identity and authorization boundary

- Assign dedicated service accounts to the broker, public Slackbot service,
  Slackbot job, and API service. Do not reuse a broad default service account.
- Grant only the designated caller service accounts
  `roles/run.invoker` on the broker Cloud Run service, including the required
  cross-project bindings. Callers send a Google-signed ID token whose audience
  is the broker's configured receiving service URL/audience. Verify the token
  at Cloud Run and independently authorize the verified caller principal inside
  the broker.
- Broker authorization is deny-by-default and maps principal + operation +
  installation scope to explicit grants. A caller cannot supply an arbitrary
  team ID and thereby select credentials. Installation identity must be derived
  from verified OAuth provenance or an approved server-side mapping. Operator
  install/reinstall/recovery permissions are separate from runtime token-read
  grants and require explicit per-installation authorization.
- Cloud Run IAM authentication protects service-to-service invocation; it does
  not mean the broker has no network path or that its public ingress adapter is
  private. Explicitly review ingress, TLS, audience, redirects, and browser
  CSRF/state behavior. Do not expose token lookup to browser clients.
- The public Slackbot service's Cloud Run IAM principal identifies the ingress
  adapter only; it is **not** the human operator and grants no operator
  authority. Reject forwarded browser identity/role headers and caller-supplied
  team IDs as authorization evidence.
- Before starting OAuth redirect, require an approved Auth identity authority to
  issue a short-lived signed operator assertion/session. Bind verified operator
  identity, intended action, server-approved resource/installation intent, and
  browser/session binding to the OAuth transaction. Verify the assertion's
  signature, issuer, audience, expiry, and session binding at the broker; after
  Slack's verified response supplies
  installation identity, re-check the operator's grant for that exact
  installation and action before publication. Runtime token-read grants never
  authorize install, reinstall, or recovery.
- The exact Auth authority, issuer, JWKS/key rotation, audience, role claims,
  session binding, and operator-to-installation role mapping are undecided
  human security gates. Adding operator identity verification and UX to the
  browser flow is an explicit product/operations change, not an assumption
  satisfied by the ingress service identity.
- Do not give API, job, or public Slackbot service accounts DB credential-table
  or KMS decrypt permissions. Only the broker service identity receives the
  minimum database and decrypt permissions required. Separate KMS key
  administration from broker runtime decryption access.
- Prefer a dedicated database schema and broker-only runtime role, with a
  separate migration owner. Verify effective grants and ownership: a schema
  name alone does not constrain broad database owner/superuser access.

### Proposed additive data model and protection

After human schema approval, add—not repurpose plaintext columns for—protected
records. Conceptual records include:

- Installation identity, installation epoch, active/tombstoned state,
  `HEALTH_HOLD`, and target-scoped `last_mutation`.
- Bot and user credential rows keyed independently by installation, kind,
  verified subject, epoch, and generation. A user credential identity includes
  installation identity + user kind + verified Slack user subject; a bot
  credential identity includes installation identity + explicit verified bot
  identity. Persist one encrypted access+refresh-token bundle per credential
  generation, not separate fields with independently chosen encryption context.
  Store only ciphertext plus key reference, nonce, wrapped DEK,
  schema/version metadata, and nonsecret expiry/status fields.
- Durable refresh/existing-token migration attempts with epoch, generation,
  attempt ID, opaque execution-owner ID, `READY`/`ATTEMPTED`/`QUARANTINED`
  state, and safe timestamps/outcomes. OAuth transaction rows hold a digest of
  state, transaction provenance, baseline counter, attempt owner/status, and
  safe outcome—not raw state, nonce, code, or token.
- A singleton transactional ordering-counter row, per-installation mutation
  stamps, retained uninstall tombstones, per-principal/per-installation grants,
  and secret-safe audit records as required by the accepted spec.

The proposed encryption design is envelope encryption: for each credential-
generation bundle write, generate a fresh cryptographically random 256-bit data
encryption key (DEK) and a fresh AES-256-GCM nonce; encrypt the access+refresh
bundle as one unambiguous encoded payload and wrap that DEK with Cloud KMS.
Persist the KMS key/version reference, nonce, ciphertext, wrapped DEK, and
encryption schema version. Never reuse a DEK or nonce; use of an approved KMS
wrapping-key version follows its separate key policy. Reject field/identity
substitution.
Bind ciphertext with a canonical, unambiguous AEAD associated-data encoding of
environment, app identity, installation identity, credential kind, verified
credential subject (user subject for user tokens; explicit bot identity for bot
tokens), installation epoch, generation, and schema version. Only the broker
runtime identity can decrypt; KMS key administrators are separate. Key rotation
retains old key versions while encrypted rows and backups still depend on them.

This is a proposal, not a selected key policy. It does not make old plaintext
columns, exports, logs, or backups safe. Any historical plaintext and restored
backup remains sensitive and requires an approved retention, cleanup, and
restore procedure. The existing Fernet password-key path is not a substitute.

The broker uses the approved Drizzle migration and ORM mapping only after
explicit human DDL/migration approval. No schema, IAM, KMS, secret grant, or
Cloud Run change is authorized by this ADR.

### Migration, cutover, and rollback boundaries

1. **Additive preparation:** after schema approval, add protected tables and
   indexes without deleting or rewriting existing fields. Deploy broker with
   access and redemption disabled; prove caller identity, grants, DB locks,
   encryption/decryption, transaction state, and secret-free logs in staging.
2. **Single-authority migration:** inventory every Python/API/service/job
   consumer, migrate credentials under controlled operator procedure, and route
   all readers through the broker. Do not operate plaintext columns, GCS JSON,
   and broker records as concurrent authorities. Preserve unrelated
   `settings` JSON values. No mixed-version deployment may contain an unlocked
   Bolt refresh path or legacy credential consumer.
3. **Staging then human-owned production toggle:** rehearse OAuth install,
   existing-token exchange, first/later refresh, crashes, multi-process lock
   loss, callback races, PITR recovery, old-token rejection, and `HEALTH_HOLD`
   release procedures on a separate development Slack app. Only named humans
   may authorize the later live app toggle and per-installation batches.
4. **Rollback distinction:** before any remote Slack exchange, a failed cutover
   may return to one coherent prior service version only if no credential
   authority changed and the rollback avoids mixed versions. After an exchange
   may have occurred, do not restore a pre-exchange credential snapshot or
   resume a stale plaintext/GCS token path. Pause new migrations, preserve
   `ATTEMPTED`/`QUARANTINED` evidence, reconcile DB state, keep healthy committed
   broker installations on their provider, and require human recovery for
   uncertain credentials. Never automatically revoke the Slack token or reset
   an ambiguous generation to `READY`.

**Point-in-time recovery (PITR) starts under an independent closed-mode
barrier.** A runtime/deployment control outside the restored database snapshot
must default the broker to deny credential lookup/access-token issuance, OAuth
code exchange and publication, refresh/migration redemption, and operator/admin
writes. Only explicitly authorized, audited recovery actions may run while
closed. Reconcile restored installation epochs, tombstones, `HEALTH_HOLD`s,
grants, global ordering counter, attempts, OAuth transactions, and KMS key
versions against safe external evidence before a human releases the barrier.
If the affected set is unknown, retain a broad hold until bounded by evidence.
A refresh token that may already have been consumed must never be automatically
reused from a restored snapshot. The approved runbook must define hold/quarantine
release authority, evidence, and rollback of the independent closed-mode control.
Rehearsal must demonstrate that restoring a DB snapshot containing an old
"enabled" or healthy state cannot open the broker while the external barrier is
closed; only a specifically authorized recovery action can operate before
human release.

## Alternatives considered

**Keep credential logic in the public Slackbot service and authenticate its
API paths.** This avoids a new service, but shares the credential decrypt
boundary with a public browser/Slack ingress process and its broader runtime.
Jobs and the API remain cross-project clients of that same authority. Rejected
for this proposal's least-privilege isolation goal; it remains simpler to
operate and can be reconsidered only with explicit human acceptance of the
weaker boundary.

**Let Python jobs and TypeScript API access DB/KMS directly.** Rejected: it
spreads credential decryption, migrations, per-installation authorization,
locking, and refresh logic across languages and service accounts; it multiplies
the secret-bearing attack surface and risks concurrent redemption. All callers
instead use the Python broker contract.

**Proxy all Slack API calls through the broker.** This would avoid returning
access tokens to consumers, but adds latency, availability coupling, API
surface, and a large request/response proxy to this credential-rotation
feature. Not selected now; it is an optional later architecture decision if
human risk review requires tokens never leave the broker.

**Encrypt each small DB value directly with KMS rather than envelope
encryption.** Direct Cloud KMS encrypt/decrypt may be simpler for small records
and avoids local DEK wrapping code, but has different payload size/cost/latency
constraints. Both direct encryption and envelope encryption may involve KMS
calls on writes and decrypts/uses; actual call frequency depends on caching,
batching, and key/data-key lifecycle. No KMS-call reduction is claimed for
envelope encryption. It is not selected pending measurement and human key-policy
approval. Do not treat either mechanism as approved by this ADR.

**Continue plaintext/GCS stores with tighter grants.** Rejected as the final
architecture because those stores remain competing authorities and cannot
provide the required cross-instance attempt state, callback provenance, and
shared provider semantics. They may exist only during an explicitly bounded
migration window, with no mixed authority at cutover.

**Do nothing.** Rejected as a target state because exposed/stale token copies,
independent refresh paths, and broad secret grants remain unresolved.

## Consequences

**Better:**

- One credential, OAuth, and refresh authority; consistent bot/user generation
  fencing across Bolt authorization, jobs, and TypeScript API.
- Dedicated broker identity can be the only principal able to decrypt
  credential rows. Narrow per-caller invocation and per-installation grants
  replace broad/default secret access and caller-selected team IDs.
- A durable attempt and callback transaction model makes crash, replay,
  tombstone, stale callback, and recovery states visible to operators without
  logging secrets.
- Application-owned callback handling can preserve transaction provenance and
  avoid the pinned Bolt callback's code-bearing error logging path.

**Accepted risks and costs, subject to human approval:**

- Broker outage, DB outage, lock contention, or KMS latency/outage fails token
  access closed. No in-memory lock or stale-token fallback is a correctness
  path. Set broker concurrency, DB connection budget, timeouts, monitoring, and
  recovery objectives before deployment.
- The singleton ordering counter serializes short DB mutation transactions and
  may become a contention point; target-row locks serialize each credential.
  The counter must never be held during Slack calls. Measure its cost at
  expected installation/transaction volume and obtain scalability review.
- Every refresh/migration has multiple DB transactions around a non-transactional
  Slack call. Persisted `ATTEMPTED` state trades automatic availability for
  avoiding blind reuse after ambiguous remote effects; human recovery may be
  required even when Slack actually completed the call.
- KMS envelope encryption adds key lifecycle, version retention, restore, and
  cryptographic implementation obligations. Backups and historical plaintext
  remain sensitive even after application cutover.
- IAM invocation proves the caller service identity, not its right to every
  Slack installation. Broker principal-to-installation/action authorization
  remains mandatory. The OAuth route is externally reachable through the public
  adapter; state/CSRF and secret-safe logging remain application security
  requirements.
- The adapter's Cloud Run IAM identity cannot establish who initiated a browser
  install. Operator actions require a separate short-lived signed assertion and
  broker-side reauthorization after Slack identity verification. Auth issuer,
  JWKS, role mapping, and operator-flow UX remain unsettled and block production
  authorization until human-reviewed.
- After PITR, the independent closed-mode barrier may hold all credential and
  OAuth operations when only a subset is affected. This is an intentional
  availability cost: uncertainty about restored attempt/order/grant state must
  not be resolved by enabling normal redemption.
- A separate service increases deployment, networking, monitoring, and
  on-call complexity. Same image does not mean same trust boundary: the broker
  must remain a distinct service with distinct identity and access policy.
- OAuth callback codes and state arrive at public ingress. Verify Cloud Run,
  proxy, and application request logging do not retain callback query strings
  or sensitive bodies; application-level redaction alone is insufficient.

**Human approvals still required (each is a separate gate):**

1. Broker placement, service design, dedicated service accounts, and exact
   cross-project `roles/run.invoker` principal-to-service mapping and ID-token
   audience policy.
2. Per-installation broker grants, runtime principal/action matrix, operator
   roles, reinstall/recovery authority, and audit access; separately approve the
   Auth identity authority, issuer/JWKS, signed operator assertion/session
   format, role claims, browser/session binding, and operator UX changes.
3. Encryption choice, KMS key ownership/admin separation, broker decrypt
   permission, key rotation/version retention, backup sensitivity, and
   cryptographic restore/recovery procedure.
4. Additive schema DDL, Drizzle migrations, indexes, data migration, and
   plaintext-field cleanup plan.
5. Acceptance of lock/counter contention and broker availability budgets,
   post-exchange `HEALTH_HOLD`, independent PITR closed-mode barrier and
   reconciliation, ambiguous `ATTEMPTED` recovery, and in-flight old-refresh/
   remote-effect behavior.
6. A later explicit production app toggle, production inventory, canary/batch
   thresholds, stop-rule owner, and any production credential operation.

Until these gates are approved, this ADR remains **PROPOSED**. It is design
documentation only: no schema, code, IAM, KMS, secret-access, deployment, or
production change is authorized.
