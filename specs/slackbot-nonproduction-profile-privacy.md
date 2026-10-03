# Slackbot non-production profile privacy

> Human decision: preserve staging's own Slack identity tables and real Slack IDs for operational lookup; do not treat Slack IDs as anonymized data.

## 1. Summary

The Slackbot must not copy personal profile details from Slack into local or staging databases. Production retains its current profile synchronization behavior. Staging keeps its own `slack_users`, `slack_spaces`, and `orgs_x_slack_spaces` rows rather than importing those tables from production during a refresh.

## 2. Context & links

- App affected: `apps/slackbot` (service and scheduled scripts job).
- Staging refresh: PR #768 and `docs/STAGING_REFRESH.md` on that PR.
- Profile writers: `utilities/helper_functions.py`, `scripts/update_slack_users.py`, and `features/user.py`.
- Environment configuration: `scripts/cloud-run-env.sh` and the local/Cloud Run env examples.

## 3. User stories

- As a staging operator, I can exercise Slack ID-based bot flows without importing workspace members' names, emails, or photos.
- As a production operator, I retain existing profile sync and identity matching.

## 4. Acceptance criteria

- **AC-1** — Only an explicitly configured production Slackbot may persist real Slack profile names, emails, and avatars. Missing or invalid environment configuration cannot enable real-profile writes; the service and scripts job receive the same explicit classification from their deployment configuration.
- **AC-2** — Given a non-production Slack ID already in `slack_users`, `get_user` resolves the existing row and preserves its `user_id` link without fetching or persisting Slack profile details. Real Slack IDs remain available for lookup; the staging tables are not copied from production.
- **AC-3** — Given a previously unseen non-production Slack ID, `get_user` creates a linked synthetic `User` and `SlackUser` with a sink email keyed to the new `users.id`, `F3 <id>` name, and null avatars. It never matches a copied user by a Slack-supplied email, stores no Slack-supplied name/email/avatar, and resolves repeat or concurrent requests to the same identity.
- **AC-4** — Direct `create_user` calls in non-production obey the same synthetic-only policy. When an existing Slack row lacks a `user_id`, linking it must not use a Slack-supplied email. Production's existing email match, creation, and profile update behavior is unchanged.
- **AC-5** — Non-production `populate_users`, scheduled `update_slack_users`, and forced/admin refresh do not enumerate Slack workspace members or update profile fields. Production retains those paths.
- **AC-6** — Non-production user-profile form submissions cannot persist personal names, emergency contacts, free-text profile metadata, or uploaded photographs. Production retains those edits.
- **AC-7** — Tests cover production, staging/local, missing/invalid environment classification, known and new Slack IDs, repeat/concurrent lookup, direct creation, bulk-sync no-op, forced sync, and profile-form no-op. Tests use fabricated profile inputs and verify both `users` and `slack_users` writes.

## 5. Roles & authorization

This changes no Slack or F3 authorization grants. Existing Slack handlers retain their permissions. The deployment operator controls the environment classification; only the approved production deployment may enable real-profile persistence. Retaining raw Slack IDs in staging is a documented security trade-off, not a claim of de-identification.

## 6. Out of scope / non-goals

- Automatically cleaning profile details already written to staging; this requires a separately reviewed cleanup after safe writers deploy.
- Obfuscating operational Slack IDs, or linking newly observed Slack members to pre-existing F3 users by email in non-production.
- Guaranteeing that free text, messages, uploads, or every other application's data contains no PII. PR #768 documents known limits of free-text name scrubbing.

Production rollout requires `SLACKBOT_ENV=production` on both existing Cloud Run resources—the `f3-slackbot` service and `f3-slackbot-scripts` job in project `f3-slackbot`, region `us-central1`—**before** deploying the privacy code/image. The release workflow sets target classification, and `scripts/cloud-run-env.sh --env prod` sets it for updates, but neither changes resources that are already running; an operator must verify/backfill both resources first. Verify the service's traffic-serving revision and the job template have `SLACKBOT_ENV=production`. This is an operator-run prerequisite, not an automated cleanup: synthetic users and historical profile data are not automatically deleted.

## 7. Critical-path test cases

- A known real Slack ID resolves its retained staging link without a Slack profile API call.
- An unknown real Slack ID yields a repeatable synthetic user with only sink email and synthetic names.
- The forced and scheduled refreshes cannot re-import profiles in staging.
- Production continues its existing email-based mapping and profile synchronization.

## 8. Observability

Report failures or skipped work without logging Slack profile payloads, personal details, tokens, or copied database contents. Verification reports aggregate violations only.
