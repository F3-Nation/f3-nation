# Slackbot non-production profile privacy

> Human decision: preserve staging's own Slack identity tables and real Slack IDs for operational lookup; do not treat Slack IDs as anonymized data.

## 1. Summary

The Slackbot must not copy personal profile details sourced from Slack APIs into local or staging databases. This restriction applies to Slack member imports, lookups, and synchronization; it does not prohibit a user from submitting or editing their own profile through the F3 user-profile form. User-submitted names, emergency contacts, free-text metadata, and uploaded avatars may intentionally be persisted in local or staging. Production retains its current Slack profile synchronization behavior. Staging keeps its own `slack_users`, `slack_spaces`, and `orgs_x_slack_spaces` rows rather than importing those tables from production during a refresh.

## 2. Context & links

- App affected: `apps/slackbot` (service and scheduled scripts job).
- Staging refreshes must preserve staging-owned identity tables; no staging refresh runbook is maintained in this repository.
- Profile writers: `utilities/helper_functions.py`, `scripts/update_slack_users.py`, and `features/user.py`.
- Environment configuration: `scripts/cloud-run-env.sh` and the local/Cloud Run env examples.

## 3. User stories

- As a staging operator, I can exercise Slack ID-based bot flows without importing workspace members' names, emails, or photos from Slack APIs.
- As a non-production user, I can edit my own F3 profile and submit my own contact details and avatar through the profile form.
- As a production operator, I retain existing profile sync and identity matching.

## 4. Acceptance criteria

- **AC-1** — Only an explicitly configured production Slackbot may persist names, emails, and avatars sourced from Slack APIs. This rule governs Slack-derived profile imports/synchronization, not values a user submits for their own profile in the F3 profile form. Missing or invalid environment configuration cannot enable Slack-derived profile writes; the service and scripts job receive the same explicit classification from their deployment configuration.
- **AC-2** — Given a non-production Slack ID already in `slack_users`, `get_user` resolves the existing row and preserves its `user_id` link without fetching or persisting Slack profile details. Real Slack IDs remain available for lookup; the staging tables are not copied from production.
- **AC-3** — Given a previously unseen non-production Slack ID, `get_user` creates a linked synthetic `User` and `SlackUser` with a sink email keyed to the new `users.id`, `F3 <id>` name, and null avatars. It never matches a copied user by a Slack-supplied email, stores no Slack-supplied name/email/avatar, and resolves repeat or concurrent requests to the same identity.
- **AC-4** — Direct `create_user` calls in non-production obey the same synthetic-only policy. When an existing Slack row lacks a `user_id`, linking it must not use a Slack-supplied email. Production's existing email match, creation, and profile update behavior is unchanged.
- **AC-5** — Non-production `populate_users`, scheduled `update_slack_users`, and forced/admin refresh do not enumerate Slack workspace members or update profile fields. Production retains those paths.
- **AC-6** — A non-production user's F3 profile-form submission may persist that user's submitted name, home region, emergency-contact fields, free-text profile metadata, and uploaded avatar to that linked `users` row only. These user-submitted values are intentionally allowed personal data in local/staging and are distinct from Slack-API-sourced profile details, which remain prohibited by AC-1 through AC-5. Handling the form must not fetch a Slack profile payload or update another user's row.
- **AC-7** — Tests cover production, staging/local, missing/invalid environment classification, known and new Slack IDs, repeat/concurrent lookup, direct creation, bulk-sync no-op, forced sync, and user-submitted profile-form edits. Tests use fabricated inputs and verify Slack-derived profile values are not imported while submitted form values are written only to the linked current user's `users` row (and do not alter unrelated `slack_users` rows).

## 5. Roles & authorization

This changes no Slack or F3 authorization grants. Existing Slack handlers retain their permissions. The deployment operator controls the environment classification; only the approved production deployment may enable Slack-API-derived profile persistence. Non-production users may intentionally persist PII they submit for their own profile through the authorized F3 form. Retaining raw Slack IDs in staging is a documented security trade-off, not a claim of de-identification.

## 6. Out of scope / non-goals

- Automatically cleaning profile details already written to staging; this requires a separately reviewed cleanup after safe writers deploy.
- Obfuscating operational Slack IDs, or linking newly observed Slack members to pre-existing F3 users by email in non-production.
- Guaranteeing that free text, messages, uploads, or every other application's data contains no PII. User-submitted profile text and avatar uploads are intentionally stored as described in AC-6; free-text name scrubbing has known limits.

The normal release workflow passes `SLACKBOT_ENV=production` in the production deploy flags for both Cloud Run resources, so the privacy image is deployed with that classification on the new service revision and job template. Before a manual or other out-of-workflow deployment of the privacy image, backfill both current production resources—the `f3-slackbot` service and `f3-slackbot-scripts` job in project `f3-slackbot`, region `us-central1`—and explicitly include `SLACKBOT_ENV=production` in the image deployment. For rollback, redeploy the older image with `SLACKBOT_ENV=production` explicitly set; do not route traffic to an older immutable service revision or run an older job template unless it has been confirmed to already have that classification. Updating current service or job configuration does not retrofit older revisions or templates. Verify the traffic-serving service revision and job template have the production classification. This is not an automated cleanup: synthetic users and historical profile data are not automatically deleted.

## 7. Critical-path test cases

- A known real Slack ID resolves its retained staging link without a Slack profile API call.
- An unknown real Slack ID yields a repeatable synthetic user with only sink email and synthetic names.
- The forced and scheduled refreshes cannot re-import profiles from Slack APIs in staging.
- A non-production user's submitted profile edits update only that user's linked F3 profile without fetching their Slack profile payload.
- Production continues its existing email-based mapping and profile synchronization.

## 8. Observability

Report failures or skipped work without logging Slack profile payloads, personal details, tokens, or copied database contents. Verification reports aggregate violations only.
