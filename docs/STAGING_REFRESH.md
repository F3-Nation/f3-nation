# Staging Refresh: Prod → Obfuscate → Staging (F3-65)

> **Status: Phase 1 — proven against the local sandbox seed ONLY.**
> The obfuscation script has never touched real data. It must not be run
> against any copy of production until a human has reviewed the PII inventory
> below, reviewed the script, and supervises the run. See
> [Hard human gate](#hard-human-gate).

This document describes the staging-refresh pipeline: taking a copy of the
production database (`f3data`), obfuscating all PII and stripping all secrets,
and loading the result into staging (`f3data-nonprod`).

## Pipeline design

```text
 ┌───────────┐  pg_dump   ┌──────────────────────────┐  pg_dump   ┌────────────────┐
 │  f3data   │ ─────────► │  intermediate instance    │ ─────────► │ f3data-nonprod │
 │  (prod)   │  (export)  │  (locked-down, ephemeral) │  (load)    │   (staging)    │
 └───────────┘            │  obfuscate-db.ts runs     │            └────────────────┘
                          │  HERE, never on prod      │
                          └──────────────────────────┘
```

1. **Export**: `pg_dump` the prod database (`f3data`). The dump itself is
   prod-classified data — treat it like production (no laptops without
   disk encryption, delete after the run).
2. **Obfuscate on an intermediate instance** — never in place on prod, and
   never directly on staging (a failed half-run must not leave un-obfuscated
   PII in a lower environment). Recommended concretely:
   - **Preferred: a throwaway dockerized Postgres on the operator's machine or
     a locked-down ephemeral Cloud SQL instance in the prod project** (no
     public IP, IAM-only access, deleted the same day). Restore the dump
     there, run `obfuscate-db.ts` against it, `pg_dump` the result.
   - The local-docker option keeps the un-obfuscated copy off shared
     infrastructure entirely and matches how the script was verified.
     Before obfuscating, check that the dump is not _ahead_ of the branch
     you are running from: compare the applied migrations in the restored copy
     (`drizzle.__drizzle_migrations`) with `packages/db/drizzle/`. A dump that
     is behind is fine (absent tables are skipped); one that is ahead has
     tables this script has never classified, and the coverage gate refuses
     the run before it writes anything. Better to know before booking the window.
3. **Load**: restore the _obfuscated_ dump into `f3data-nonprod`.
4. **Seed sign-in identities** on staging. The refresh truncates every
   session and leaves every address at `@obfuscated.f3nation.dev`, so no one
   can receive an email code. Name a few routable addresses at run time
   (nothing is committed; no real user's row is un-obfuscated):

   ```bash
   DATABASE_URL=postgresql://...staging... pnpm -F @acme/scripts seed-staging-logins -- \
     --allow-db <staging-db-name> --login you@example.com:admin
   ```

   Role is `admin`, `editor` or `none`, granted on the nation org. Run this
   on staging only, never on the intermediate copy, where
   `obfuscate-db:verify-target`'s email sweep would (correctly) flag it.

5. **Destroy** the intermediate instance and both the raw and intermediate
   dumps. Only the obfuscated dump may outlive the run.

The seed for per-PR preview databases (`.github/workflows/preview-env.yml`)
currently uses the synthetic local seed (`packages/db/src/local-seed.ts`).
Once this pipeline is approved and running, the preview seed switches from
synthetic data to this pipeline's obfuscated output, giving previews
production-shaped data with zero PII.

## Running the script

```bash
# Dry run — reports what would change, writes nothing
OBFUSCATION_SALT=... DATABASE_URL=postgresql://... pnpm -F @acme/scripts obfuscate-db -- \
  --allow-db f3data_copy --i-understand-this-rewrites-data --dry-run

# Real run
OBFUSCATION_SALT=... DATABASE_URL=postgresql://... pnpm -F @acme/scripts obfuscate-db -- \
  --allow-db f3data_copy --i-understand-this-rewrites-data
```

`OBFUSCATION_SALT` is required and must be a long, random secret stored in the
prod secret manager — never committed to source. This repo is public; a
committed salt would let anyone rebuild a rainbow table over candidate
emails/phones/names and reverse a "fake" value back to the real input.

### Double-flag safety design (belt and suspenders)

The script refuses to write anything unless **both** flags are present:

| Guard                                                                                                                       | What it protects against                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--allow-db <name>` must exactly match the database name in `DATABASE_URL` **and** the server-reported `current_database()` | Pointing the script at the wrong database (e.g. a stale `DATABASE_URL` in a shell or `.env` aimed at prod). The operator has to name the intended target explicitly. |
| `--i-understand-this-rewrites-data`                                                                                         | Muscle-memory / copy-paste runs. There is no way to run destructively without typing an explicit acknowledgement.                                                    |
| The exact production database name (`f3data`) or any name containing `prod` is **always refused**                           | Even a fully-flagged run cannot execute against anything named like production. Obfuscate a copy, never the source.                                                  |
| `--dry-run`                                                                                                                 | Full report of tables/columns/row counts with zero writes — run this first, always.                                                                                  |

`--preserve-local-seed` additionally keeps the committed local dev fixtures
(`*@f3local.dev` users, `local-*` API keys, `*-local` OAuth clients) intact so
a sandbox database stays usable for local login after obfuscation. It is
**not** used for the staging refresh — prod has no such rows.

### Determinism

All fakes are derived from `sha256(salt + input)` with the required
`OBFUSCATION_SALT` secret, so:

- the same input value maps to the same fake **everywhere** — a user's email
  in `users.email`, `update_requests.submitted_by`, and inside a JSON `meta`
  blob all become the same `user-<hash8>@obfuscated.f3nation.dev`, preserving
  relational/analytical consistency;
- repeated refreshes are diff-friendly (same prod value → same staging value
  across runs, as long as the salt doesn't change).

Formats: emails → `user-<hash8>@obfuscated.f3nation.dev`, names →
`F3 User <hash6>`, phones → `555-<hash3>-<hash4>`, Slack IDs →
`U<HASH8>` (lengthened on collision). Free-text contact/emergency fields are
nulled. JSON/meta and free-text columns are scrubbed of email-shaped strings
by regex, replaced with the same deterministic fakes.

## PII inventory

Classification legend — **OBFUSCATE**: deterministic fake; **SCRUB**: regex
replacement of email-shaped strings **and Slack mention syntax** with
deterministic fakes; **NULL OUT**: set to NULL; **TRUNCATE/DELETE**: rows
removed (secrets don't belong in staging); **REWRITE**: not PII, but a prod
URL repointed at its staging equivalent; **KEEP**: non-PII, left untouched.

> **Known limit of SCRUB — read this before approving a load.** SCRUB is
> regex-based. It removes email-shaped strings and Slack mentions
> (`<@U…>` and the pipe form `<@U…|display name>`, including enterprise-grid
> `W…` ids). It does **not** remove real personal names that appear in free
> text with no `@` alongside them. The slackbot writes exactly that: a
> `backblast` body is assembled as `Q: {q_name} … PAX: {pax_names} …` from
> `users.f3_name` (see `apps/slackbot/features/backblast.py`). So after a run
> `users.f3_name` holds a fake, but a backblast naming that person still
> carries their real F3 name — and because `attendance.user_id` is preserved
> by design, the fake↔real mapping is joinable by anyone who reads the text.
> Closing this needs a name-substitution pass, not a regex, and it is **not**
> in this script today. Read the SCRUB rows below as "de-identified for
> emails and Slack ids", not "de-identified".

### `public` schema

| Table                                                                                                             | Column(s)                                                    | Classification            | Notes                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                                                                                                           | `email`                                                      | OBFUSCATE (email)         | Unique; deterministic hash keeps FKs-by-email consistent                                                                             |
| `users`                                                                                                           | `f3_name`, `first_name`, `last_name`                         | OBFUSCATE (name)          |                                                                                                                                      |
| `users`                                                                                                           | `phone`                                                      | OBFUSCATE (phone)         |                                                                                                                                      |
| `users`                                                                                                           | `avatar_url`                                                 | NULL OUT                  | Personal photo URL                                                                                                                   |
| `users`                                                                                                           | `emergency_contact`, `emergency_phone`, `emergency_notes`    | NULL OUT                  | Highly sensitive free text                                                                                                           |
| `users`                                                                                                           | `meta` (json)                                                | SCRUB                     | May carry emails/free text                                                                                                           |
| `users`                                                                                                           | `email_verified`, `status`, `home_region_id`, ids/timestamps | KEEP                      |                                                                                                                                      |
| `slack_users`                                                                                                     | `slack_id`                                                   | OBFUSCATE (id)            | External identifier tied to a person                                                                                                 |
| `slack_users`                                                                                                     | `user_name`                                                  | OBFUSCATE (name)          |                                                                                                                                      |
| `slack_users`                                                                                                     | `email`                                                      | OBFUSCATE (email)         |                                                                                                                                      |
| `slack_users`                                                                                                     | `avatar_url`                                                 | NULL OUT                  |                                                                                                                                      |
| `slack_users`                                                                                                     | `strava_access_token`, `strava_refresh_token`                | NULL OUT                  | OAuth secrets                                                                                                                        |
| `slack_users`                                                                                                     | `strava_athlete_id`, `strava_expires_at`                     | NULL OUT                  | Linked-account identifiers                                                                                                           |
| `slack_users`                                                                                                     | `meta` (json)                                                | SCRUB                     |                                                                                                                                      |
| `slack_spaces`                                                                                                    | `bot_token`                                                  | NULL OUT                  | Slack bot secret                                                                                                                     |
| `slack_spaces`                                                                                                    | `settings` (json)                                            | SCRUB                     |                                                                                                                                      |
| `slack_spaces`                                                                                                    | `team_id`, `workspace_name`                                  | KEEP                      | Workspace-level, not personal                                                                                                        |
| `orgs`                                                                                                            | `email`                                                      | OBFUSCATE (email)         | Region/AO contact inboxes are often personal                                                                                         |
| `orgs`                                                                                                            | `phone`                                                      | OBFUSCATE (phone)         |                                                                                                                                      |
| `orgs`                                                                                                            | `description`                                                | SCRUB                     | Emails hide in free text                                                                                                             |
| `orgs`                                                                                                            | `meta` (json)                                                | SCRUB                     |                                                                                                                                      |
| `orgs`                                                                                                            | `website`                                                    | SCRUB                     | Real-data finding (2026-07-10): "website" fields carry typed-in emails                                                               |
| `orgs`                                                                                                            | `twitter`, `facebook`, `instagram`, `logo_url`               | KEEP                      | Public org presence                                                                                                                  |
| `locations`                                                                                                       | `email`                                                      | OBFUSCATE (email)         |                                                                                                                                      |
| `locations`                                                                                                       | `description`                                                | SCRUB                     |                                                                                                                                      |
| `locations`                                                                                                       | `meta` (json)                                                | SCRUB                     |                                                                                                                                      |
| `locations`                                                                                                       | address/lat/lon                                              | KEEP                      | Public workout locations                                                                                                             |
| `events`                                                                                                          | `email`                                                      | OBFUSCATE (email)         | Event contact                                                                                                                        |
| `events`                                                                                                          | `description`                                                | SCRUB                     |                                                                                                                                      |
| `events`                                                                                                          | `meta` (json)                                                | SCRUB                     |                                                                                                                                      |
| `event_instances`                                                                                                 | `email`                                                      | OBFUSCATE (email)         |                                                                                                                                      |
| `event_instances`                                                                                                 | `description`, `preblast`, `backblast`                       | SCRUB                     | Free text authored by users. Emails + Slack mentions only — real names survive, see the SCRUB limit above                            |
| `event_instances`                                                                                                 | `preblast_rich`, `backblast_rich`, `meta` (json)             | SCRUB                     | Slack Block Kit. Emails + Slack mentions only — real names survive, see the SCRUB limit above                                        |
| `update_requests`                                                                                                 | `submitted_by`, `reviewed_by`                                | OBFUSCATE (email)         | Submitter/reviewer contact                                                                                                           |
| `update_requests`                                                                                                 | `event_contact_email`, `location_contact_email`              | OBFUSCATE (email)         |                                                                                                                                      |
| `update_requests`                                                                                                 | `event_description`, `location_description`                  | SCRUB                     |                                                                                                                                      |
| `update_requests`                                                                                                 | `ao_website`                                                 | SCRUB                     | Website field carries typed-in emails (see `orgs.website`)                                                                           |
| `update_requests`                                                                                                 | `event_meta`, `meta` (json)                                  | SCRUB                     |                                                                                                                                      |
| `update_requests`                                                                                                 | `token`                                                      | REGENERATE                | Capability token mailed to submitters — new random UUID                                                                              |
| `expansions`                                                                                                      | `user_lat`, `user_lon`                                       | OBFUSCATE (coarsen ~11km) | User-submitted home coordinates                                                                                                      |
| `expansions`                                                                                                      | `area`, `pinned_lat`, `pinned_lon`                           | KEEP                      | Proposed public location                                                                                                             |
| `expansions_x_users`                                                                                              | `notes`                                                      | NULL OUT                  | Free text                                                                                                                            |
| `attendance`                                                                                                      | `meta` (json)                                                | SCRUB                     |                                                                                                                                      |
| `positions`                                                                                                       | `description`                                                | SCRUB                     | Names are role titles (Nant'an, Site Q) — KEEP                                                                                       |
| `achievements`                                                                                                    | `description`, `meta` (json)                                 | SCRUB                     |                                                                                                                                      |
| `auth_sessions`                                                                                                   | all                                                          | TRUNCATE                  | Live session tokens                                                                                                                  |
| `auth_verification_tokens`                                                                                        | all                                                          | TRUNCATE                  | Magic-link tokens                                                                                                                    |
| `auth_accounts`                                                                                                   | all                                                          | TRUNCATE                  | OAuth refresh/access/id tokens per user                                                                                              |
| `api_keys`                                                                                                        | all                                                          | DELETE                    | Live API secrets; cascades `roles_x_api_keys_x_org`. Staging gets its own keys. With `--preserve-local-seed`, `local-*` keys survive |
| `permissions`, `roles`, `event_types`, `event_tags`, `attendance_types`, join tables (`*_x_*`), `alembic_version` | all                                                          | KEEP                      | Reference data / integer-FK join rows, no PII                                                                                        |

### `auth` schema (OAuth/OIDC provider, apps/auth)

| Table                                                                                                                                                                            | Column(s)                                                              | Classification          | Notes                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.oauth_authorization_codes`                                                                                                                                                 | all                                                                    | TRUNCATE                | Live auth codes                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.oauth_access_tokens`                                                                                                                                                       | all                                                                    | TRUNCATE                | Live tokens                                                                                                                                                                                                                                                                                                                                                                                          |
| `auth.oauth_refresh_tokens`                                                                                                                                                      | all                                                                    | TRUNCATE                | Live tokens                                                                                                                                                                                                                                                                                                                                                                                          |
| `auth.email_mfa_codes`                                                                                                                                                           | all                                                                    | TRUNCATE                | `email` column + code hashes                                                                                                                                                                                                                                                                                                                                                                         |
| `auth.oauth_clients`                                                                                                                                                             | `client_secret_hash`                                                   | OBFUSCATE (invalidate)  | Overwritten with a hash derived from a non-secret string, so no prod secret authenticates against staging. `*-local` clients survive only with `--preserve-local-seed`                                                                                                                                                                                                                               |
| `auth.oauth_clients`                                                                                                                                                             | `redirect_uris`, `allowed_origin`                                      | REWRITE                 | Repointed at staging: known F3 prod hosts map to their `staging.` twin (`auth`/`auth2` → `staging.auth2`), other non-staging `*.f3nation.com` hosts are dropped, third-party and localhost URIs are left alone. Otherwise a flow started in staging hands its code or backchannel logout to production. An F3 `allowed_origin` with no twin becomes `''`                                             |
| `auth.oauth_clients`                                                                                                                                                             | `id`, `name`, `scopes`                                                 | KEEP                    | Client config, no PII                                                                                                                                                                                                                                                                                                                                                                                |
| `auth.user`                                                                                                                                                                      | `name`, `f3_name`, `hospital_name`                                     | OBFUSCATE (name)        | Real names / hospital                                                                                                                                                                                                                                                                                                                                                                                |
| `auth.user`                                                                                                                                                                      | `email`                                                                | OBFUSCATE (email)       |                                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.user`                                                                                                                                                                      | `id` (email-as-id)                                                     | OBFUSCATE (email-as-id) | This legacy table keys users by email address, so the PK itself is PII (real-data finding 2026-07-10); rewritten through the same deterministic map as `email`                                                                                                                                                                                                                                       |
| `auth.user`                                                                                                                                                                      | `image`                                                                | NULL OUT                | Avatar URL                                                                                                                                                                                                                                                                                                                                                                                           |
| `auth.user_profiles`                                                                                                                                                             | `hospital_name`                                                        | OBFUSCATE (name)        |                                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.oauth_client` (singular)                                                                                                                                                   | `client_secret`                                                        | OBFUSCATE (invalidate)  | Legacy plaintext secret; overwritten so no prod secret authenticates against staging                                                                                                                                                                                                                                                                                                                 |
| `auth.session`, `auth.verificationToken`, `auth.oauth_authorization_code`, `auth.oauth_access_token`, `auth.oauth_refresh_token`, `auth.email_mfa_code` (singular legacy family) | all                                                                    | TRUNCATE                | Live sessions/tokens/codes; truncated as a group. Absent members are skipped — only one naming generation exists in a given target                                                                                                                                                                                                                                                                   |
| `auth.better_auth_user`                                                                                                                                                          | `name`                                                                 | OBFUSCATE (name)        | Real name on Better Auth's shadow identity row                                                                                                                                                                                                                                                                                                                                                       |
| `auth.better_auth_user`                                                                                                                                                          | `email`                                                                | OBFUSCATE (email)       | Already rewritten in practice by migration 0025's `users_email_sync_better_auth` trigger when `public.users.email` changes. Kept as defence in depth: a restore that replays with `session_replication_role = replica`, a target predating `0025`, or a dropped trigger would all leave the real email here                                                                                          |
| `auth.better_auth_user`                                                                                                                                                          | `image`                                                                | NULL OUT                | Avatar URL                                                                                                                                                                                                                                                                                                                                                                                           |
| `auth.better_auth_user`                                                                                                                                                          | `id`, `f3_user_id`, `email_verified`                                   | KEEP                    | `id` is `String(public.users.id)`, NOT an email (unlike legacy `auth.user`) — it is the join key every other better_auth table FKs to. `f3_user_id` is `GENERATED ALWAYS AS ((id)::integer) STORED` with an FK to `users.id`, a UNIQUE constraint, and a CHECK that `id ~ '^[1-9][0-9]*$'` (migration `0024`) — rewriting `id` would break all four, and an unlinked shadow row is not constructible |
| `auth.better_auth_session`                                                                                                                                                       | all                                                                    | TRUNCATE                | Session `token` plus `ip_address` / `user_agent`                                                                                                                                                                                                                                                                                                                                                     |
| `auth.better_auth_account`                                                                                                                                                       | all                                                                    | TRUNCATE                | `access_token`, `refresh_token`, `id_token` **and** a `password` column                                                                                                                                                                                                                                                                                                                              |
| `auth.better_auth_verification`                                                                                                                                                  | all                                                                    | TRUNCATE                | `identifier` is the email, `value` the OTP/verification token                                                                                                                                                                                                                                                                                                                                        |
| `auth.better_auth_jwks`                                                                                                                                                          | all                                                                    | TRUNCATE                | `private_key` — the signing keys for every token the auth app issues. Must never exist outside prod; Better Auth mints a fresh keypair when the table is empty (both `signJWT` and the `/jwks` endpoint call `createJwk` on an empty set, checked against `better-auth@1.7.4`)                                                                                                                       |
| `auth.better_auth_oauth_access_token`, `auth.better_auth_oauth_refresh_token`                                                                                                    | all                                                                    | TRUNCATE                | Live bearer/refresh tokens; truncated as a group with the rows below (mutual FKs to each other and to `better_auth_session`)                                                                                                                                                                                                                                                                         |
| `auth.better_auth_oauth_consent`                                                                                                                                                 | all                                                                    | TRUNCATE                | Per-user grant state, meaningless once the tokens it authorised are gone                                                                                                                                                                                                                                                                                                                             |
| `auth.better_auth_oauth_client_assertion`                                                                                                                                        | all                                                                    | TRUNCATE                | JTI replay guard, ephemeral by design                                                                                                                                                                                                                                                                                                                                                                |
| `auth.better_auth_oauth_client`                                                                                                                                                  | `client_secret`                                                        | OBFUSCATE (invalidate)  | Same treatment as `auth.oauth_clients` — overwritten with a hash of a non-secret string. Rows are KEPT so staging still has its client registrations                                                                                                                                                                                                                                                 |
| `auth.better_auth_oauth_client`                                                                                                                                                  | `contacts`                                                             | SCRUB                   | RFC 7591 administrative contacts — real email addresses, and a `text[]`, so scrubbed element-wise                                                                                                                                                                                                                                                                                                    |
| `auth.better_auth_oauth_client`                                                                                                                                                  | `metadata`                                                             | SCRUB                   | Free-form jsonb                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.better_auth_oauth_client`                                                                                                                                                  | `redirect_uris`, `post_logout_redirect_uris`, `backchannel_logout_uri` | REWRITE                 | Repointed at staging: known F3 prod hosts map to their `staging.` twin (`auth`/`auth2` → `staging.auth2`), other non-staging `*.f3nation.com` hosts are dropped, third-party and localhost URIs are left alone. Otherwise a flow started in staging hands its code or backchannel logout to production                                                                                               |
| `auth.better_auth_oauth_client`                                                                                                                                                  | `jwks`, `jwks_uri`, `name`, `uri`, …                                   | KEEP                    | The CLIENT's public key set and its registration config — public by definition, no PII                                                                                                                                                                                                                                                                                                               |
| `auth.better_auth_oauth_resource`                                                                                                                                                | `custom_claims`, `metadata`                                            | SCRUB                   | Free-form jsonb an operator can put anything into                                                                                                                                                                                                                                                                                                                                                    |
| `auth.better_auth_oauth_client_resource`                                                                                                                                         | `metadata`                                                             | SCRUB                   | Free-form jsonb                                                                                                                                                                                                                                                                                                                                                                                      |

`auth.user`, `auth.user_profiles`, `auth.oauth_client` (singular), and the
singular session/token family above are **not** written to by any active code
path — they pre-date the repo's current NextAuth adapter
(`packages/auth/src/lib/md-pg-drizzzle-adapter.ts`'s `MDPGDrizzleAdapter`,
which reads/writes the plural tables above instead: `public.users` plus
`auth_accounts`/`auth_sessions`/`auth_verification_tokens`). They're still
physically present on prod (2026-07-10 real-data finding), so the script must
still classify and obfuscate them, but they're frozen/orphaned data, not an
actively-growing table.

The 12 `auth.better_auth_*` tables arrived with the Better Auth migration
(`0022`-`0025`, issue #876 phase 3) and are the **active** auth path, not
legacy. Two things are specific to them:

- **A trigger does part of the work.** Migration `0025` installs
  `users_email_sync_better_auth`, an `AFTER UPDATE OF email` trigger on
  `public.users` that rewrites `auth.better_auth_user.email` for the matching
  `f3_user_id`. Since `f3_user_id` is generated from `id` and FK-enforced,
  every shadow row is reachable by it. The obfuscator transforms
  `public.users` before it reaches this table, so those emails are already
  fake by then and the script's own pass is a no-op (the allowlist guard stops
  it faking a fake). **Do not reorder those two jobs** — and do not delete the
  email pass either: it is the only thing standing behind the trigger if the
  target was restored in a way that skipped it.
- **Nobody can sign in to staging after a refresh.** Truncating
  `better_auth_session` / `_account` / `_verification` logs everyone out, and
  every remaining `users.email` is an unroutable `@obfuscated.f3nation.dev`
  address, so the email-OTP flow cannot deliver a code. This is the same
  property the pre-existing `auth_sessions` / `api_keys` truncation already
  had; it is called out here because Better Auth makes it total. Staging needs
  a seeded test identity (or `--preserve-local-seed`-style fixtures) as a
  separate step — see the Hard human gate.

## Verification

`tooling/scripts/src/obfuscate-db.verify.ts`
(`pnpm -F @acme/scripts obfuscate-db:verify`) proves the script against the
**sandbox seed only**:

1. Spins up a throwaway dockerized Postgres (`postgres:18`, port 5434) — or,
   when no docker daemon is available, an ephemeral local cluster via
   `initdb`/`pg_ctl` on the same port — and runs drizzle migrations +
   `db:seed:local` (the same recipe as `preview-env.yml`'s "Build seeded
   database dump" step).
2. Plants synthetic PII: a user with real-looking email/phone/emergency data,
   sessions, verification tokens, OAuth tokens, an API key, an update request
   and a backblast with embedded emails, a Slack user with Strava tokens.
3. Runs the obfuscator (without `--preserve-local-seed`), then asserts:
   - **zero** email-shaped strings in any text/json column of the `public`
     and `auth` schemas except `@obfuscated.f3nation.dev`;
   - sessions/tokens/api-key tables are empty;
   - row counts of all kept tables are unchanged (referential integrity);
   - the same source email maps to the same fake across tables;
   - free-text scrubbing rewrote the planted backblast email;
   - attendance FKs still resolve.
4. Tears the container down and restores `packages/env/.env`.

CI runs it on every PR (`obfuscate-db-verify` in `.github/workflows/ci.yml`),
so a migration that adds an unclassified table fails on its own PR rather than
at the next refresh.

### Verifying an obfuscated copy

`tooling/scripts/src/obfuscate-db.verify-target.ts`
(`DATABASE_URL=… pnpm -F @acme/scripts obfuscate-db:verify-target`) is a
read-only assertion suite for a database the obfuscator has already run
against. Run it on the intermediate instance after step 2 and before the
load in step 3. It sweeps every text/json column of `public` and `auth` for
non-obfuscated emails, asserts the secret/session/token tables are empty,
checks the deterministic cross-table mapping, confirms OAuth client secrets
are invalidated, and checks attendance FK integrity. It refuses any database
whose name is (or looks like) production.

## Hard human gate

**No run against real data without a human in the loop. Ever.**

Before the first (and every) staging refresh:

1. A human reviews the [PII inventory](#pii-inventory) above against the
   current `packages/db/drizzle/schema.ts` — any new table or column added
   since the last review must be classified before proceeding. The script is
   deny-by-default only for the tables it knows; **new columns default to
   "leaks"**, so this review is the real safety net.
2. A human reviews `tooling/scripts/src/obfuscate-db.ts` and the latest
   verification run output. Specifically for the legacy `auth.user` /
   `auth.user_profiles` tables (see the [PII inventory](#pii-inventory) note
   above) — since they're outside this repo's own migrations, check the
   actual prod constraints before the first real run: does `auth.user.email`
   have a (case-sensitive) unique constraint that the deterministic-fake
   write could violate for the known case-variant duplicate rows, and does
   `auth.user_profiles.user_id`'s FK to `auth.user.id` have `ON UPDATE
CASCADE` (needed since the script rewrites `auth.user.id`)?
3. A human supervises the run itself: dry-run first, inspect the summary
   table, then the real run, then spot-check the output before it is loaded
   into `f3data-nonprod`.
4. Only after this gate does the preview-environment seed switch from the
   synthetic local seed to this obfuscated output.

Phase 1 (this document + script + verification harness) is scoped to the
sandbox seed. Wiring the pipeline to real exports is a separate, gated phase.
