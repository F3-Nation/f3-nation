# Slack identities within a workspace

> Human designer: Crash (@BigGillyStyle), with Tackle's review

## 1. Summary

The Slackbot stores one identity for each Slack account and workspace. Repeated
imports and concurrent requests resolve the same stored identity without losing
its F3-user link or integration data. Scheduled workout messages select one
Slack identity for a Q in the destination workspace, including when that person
has two distinct Slack accounts there.

## 2. Context & links

- Apps affected: Slackbot and the shared PostgreSQL schema/Python models.
- Identity creation and cache: [helper functions](../../apps/slackbot/utilities/helper_functions.py).
- Scheduled synchronization: [Slack-user updates](../../apps/slackbot/scripts/update_slack_users.py).
- Scheduled queries: [preblast reminders](../../apps/slackbot/scripts/preblast_reminders.py)
  and [automatic preblasts](../../apps/slackbot/scripts/auto_preblast_send.py).
- Schema: [Drizzle](../../packages/db/drizzle/schema.ts) and
  [Python models](../../packages/db-python/f3_data_models/models.py).
- [Nonproduction profile privacy](slackbot-nonproduction-profile-privacy.md)
  continues to govern profile handling outside production.
- [Database migration procedure](../db-migrations.md) governs schema rollout.
  The workspace-pair constraint must be installed before or with identity
  writers that target it in `ON CONFLICT`; shared-environment reconciliation
  requires human release-owner sign-off and a verified recovery backup.

## 3. User stories

- As a member, I can interact in different Slack workspaces without another
  workspace's cached identity being selected.
- As a Q, matching Slack identities do not multiply my event/type reminders
  within a scheduled run.
- As a release owner, I can reconcile unambiguous duplicate account records
  without discarding user links or integration data.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an eligible Slack account/workspace pair WHEN creation or
  production import repeats THEN one stored Slack identity remains. A different
  workspace or different Slack account remains a distinct identity.
- **AC-2** — GIVEN concurrent production creation calls WHEN they identify the
  same pair and member email THEN the calls complete without uniqueness errors
  and return the same committed Slack identity and F3 user. Different pairs
  with the same case-insensitive email also resolve one F3 user.
- **AC-3** — GIVEN an existing linked pair WHEN creation repeats with changed or
  missing profile data THEN its established F3-user link and integration fields
  are preserved, without creating another F3 user first.
- **AC-4** — GIVEN an unlinked identity WHEN it is resolved THEN linkage and any
  new identity/user creation commit together while existing integration data is
  retained. In production, a profile email or stored non-bot member email is
  required to create or match an F3 user. Raw Slack IDs stored as email
  placeholders are not matching evidence. Without an email, the workspace
  identity remains unlinked, preserves its display profile, and creates no F3
  user. A later email can link that same identity. Established links remain
  unchanged. Nonproduction resolution preserves synthetic profile handling.
- **AC-5** — GIVEN caller workspace context WHEN a Slack payload omits its team
  THEN that context supplies the workspace; explicit context takes precedence.
  If neither source supplies a workspace, creation fails before database work.
- **AC-6** — GIVEN identities in several workspaces WHEN cached lookup, name or
  avatar rendering, positions, or synchronization runs THEN only the requesting
  workspace's identity is selected. Cache refresh retains every pair.
- **AC-7** — GIVEN an import containing `USLACKBOT` WHEN members are populated
  THEN that system account is skipped. Other existing eligibility and
  nonproduction privacy rules remain in force.
- **AC-8** — GIVEN several Slack identities for one F3 user/workspace WHEN a
  scheduled query resolves its Q THEN it selects the greatest `slack_updated`,
  with NULL last and lowest internal ID breaking ties. Both reminder/lineup and
  automatic-preblast queries apply this rule before surrounding event joins.
  Identity matching contributes at most one row per Q/workspace; separate event
  types and region mappings remain distinct. Existing eligibility and open-Q
  behavior remain intact; this does not guarantee delivery deduplication across
  separate runs.
- **AC-9** — GIVEN duplicate account/workspace groups WHEN reconciliation runs
  THEN it aborts the entire transaction before repair if any group has distinct
  non-NULL F3-user links or more than one data-bearing row. A data-bearing row
  has any non-SQL-NULL access token, refresh token, expiry, athlete ID or metadata;
  empty values and JSON null count as present.
- **AC-10** — GIVEN only unambiguous duplicate groups WHEN reconciliation runs
  THEN it keeps a linked row first, then a data-bearing row, then lowest ID.
  It transfers the sole donor's complete four-field Strava bundle and metadata
  when needed, deletes only extra rows in that pair, and leaves every
  nonduplicate row unchanged except for the legacy workspace repair in AC-13.
  Other survivor fields, including timestamps, retain their original values. Distinct Slack accounts are not merged.
- **AC-11** — GIVEN successful reconciliation WHEN the migration commits THEN
  PostgreSQL enforces `uq_slack_users_slack_id_team_id` on
  `(slack_id, slack_team_id)`, with matching Drizzle and Python declarations.
  Any guard, lock or later migration failure rolls back repair and constraint.
  Reconciliation preserves the existing timestamp trigger's enabled mode or
  absence, including on failure.
- **AC-12** — GIVEN a migration release WHEN it is approved THEN its human-owned
  recovery plan requires a verified backup of the original affected rows,
  including survivors and re-homed identities, retained beyond the migration session, and accounts for
  both merged fields and the constraint. Synthetic local recovery tests must
  demonstrate restoration of the original rows by stable internal ID and removal
  of the constraint; workspace keys can change during reconciliation.

- **AC-13** — GIVEN identities stored with the placeholder workspace `NOT FOUND`
  WHEN reconciliation runs THEN each linked identity is re-homed only when its
  user's home region maps to exactly one distinct non-placeholder workspace
  and the destination account/workspace pair is absent. All other fields,
  including timestamps and integration data, are preserved. Any legacy row
  without a safe mapping (including an unlinked row or occupied destination)
  aborts the entire migration with aggregate-only diagnostics. The original
  trigger mode is preserved.

- **AC-14** — GIVEN an unlinked member selected for an interaction WHEN an F3
  account is required THEN identity lookup raises a fixed, actionable error
  before returning a missing F3 user ID to the caller. Q reassignment and
  backblast submission perform no attendance writes or uploads for that selection;
  unscheduled preblasts resolve their Q before saving the event. Slack name and
  avatar display, calendar browsing, help and downrange remain available without
  an F3 account link. Import and sync
  preserve unlinked identities without inventing placeholder F3 users.

## 5. Roles & authorization (RBAC)

This feature adds no API endpoint or procedure tier and grants no permission.
Existing Slack interaction authorization and F3-user matching continue to apply.

| Action                                              | Allowed                                                    | Explicitly denied                                                  |
| --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Resolve an identity for an interaction              | Existing authorized bot flow with workspace context        | Creation with no workspace context                                 |
| Import/synchronize workspace members                | Existing authorized production bot flow                    | Profile enumeration/import outside production                      |
| Reconcile shared data or apply its schema migration | Human-approved release owner using the migration procedure | Member requests, normal bot requests and read-only database access |

## 6. Out of scope / non-goals

- Merging different Slack accounts or different F3 users.
- Repairing region-to-workspace mappings.
- Removing nonduplicate system-account rows.
- Changing profile privacy, API contracts or authorization policies.
- Exactly-once delivery across scheduled job executions or network retries.

## 7. Critical-path test cases

- Real PostgreSQL contention for absent and unlinked identities, plus different
  pairs sharing one case-insensitive email.
- Migration fixtures covering survivor precedence, all integration fields,
  conflicting groups, unchanged controls, uniqueness and recovery.
- Workspace-specific cache, name/avatar, positions and synchronization tests
  with deliberately different competing values.
- Real query execution and stubbed delivery for duplicate and distinct account
  matches, with deterministic ordering and preserved event-type behavior.
- Existing nonproduction privacy regressions and repeated import behavior.

## 8. Observability

- Reconciliation errors use fixed messages and aggregate conflict counts with
  corrective hints, without identifiers or row values.
- Cached identity-link failures distinguish Slack warnings from non-Slack errors
  and include only bounded SQLSTATE and allowlisted constraint diagnostics.
- The hourly entrypoint configures structured logging for deployment and stream
  logging locally. Each completed workspace-region sync pass emits a summary
  counting identities created or linked; Slack API failures emit the sync failure event.
- Identity changes do not add profile data, credentials or personal identifiers
  to logs or public review artifacts.
- Existing delivery eligibility and error handling remain observable through
  their existing paths; no new production monitoring is required here.
