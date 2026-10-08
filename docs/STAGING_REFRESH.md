# Staging Refresh: Prod → Obfuscate → Staging (F3-65)

> **Status:** run by hand against real data on 2026-09-22/23 and 2026-10-07.
> Those runs are now one Cloud Run job, `f3-staging-refresh`, rehearsed end to
> end (including its rollback) against local stand-ins for prod and staging.
> Its first run in Cloud Run should be watched by someone who can read the
> logs and has staging DB access.

This document describes the staging-refresh pipeline: taking a copy of the
production database (`f3data`), obfuscating all PII and stripping all secrets,
and loading the result into staging (`f3data-nonprod`).

## How to refresh staging

```bash
gcloud run jobs execute f3-staging-refresh --project f3data --region us-central1 --wait
```

That's all. It takes about an hour (loading ~6M attendance rows into staging
took 18 minutes on 2026-10-07), and `--wait` returns when it's done: exit 0
means staging has fresh data, anything else means it stopped (see
[If it fails](#if-it-fails)).

**When:** right after a prod release, never right before a staging test cycle
(logins change and App Pioneers gets relinked, so leave time to work through
oddities before the next release is tested). Only when needed: prod has had
structural changes since the last refresh (new sectors or territories, a new
column prod has since populated), or someone needs fresh data. The job
refuses unless prod and staging are at the same migration level, which is
true right after a release.

**Dry run first if you're unsure.** It does everything except touch staging
(dump, obfuscate, verify, check the load), so it shows whether the real run
would go through:

```bash
gcloud run jobs execute f3-staging-refresh --project f3data --region us-central1 --wait --args=--dry-run
```

### What it does

1. Checks prod and staging are at the same migration level, and that prod
   isn't ahead of the code in the job's image.
2. Dumps prod's `public`, `auth`, `drizzle` (and `slackbot`) schemas with a
   read-only login. Never `codex`, `regionpages` or `temp`: they hold PII
   nothing here classifies.
3. Restores the dump into a throwaway Postgres inside the job's container and
   deletes the dump. Raw prod data never leaves that container.
4. Obfuscates the copy (`obfuscate-db`), then runs the verification suite
   against it (`obfuscate-db:verify-target`); every check must pass. The
   obfuscator refuses a table **or column** nobody has reviewed (see
   [Review gate](#review-gate)).
5. Works out what to load: every table staging and the copy both have, except
   staging's own OAuth client registrations, which it keeps as they are (see
   below; loading the copy's broke admin login on 2026-09-24). Each table must
   have identical columns on both sides, and every foreign key between a kept
   table and a loaded one must be one the job can keep consistent. Up to
   here, staging is untouched.
6. Backs up staging's data, stashes staging's own API keys and Slack rows,
   empties the loaded tables and loads the obfuscated copy.
7. Puts back the API keys in the keep list
   (`tooling/scripts/src/staging-refresh.config.ts`; every other key is
   dropped) and staging's Slack data, resets sequences, validates every
   foreign key one at a time, and restarts the staging slackbot.
8. Prints a summary: row counts, kept and dropped keys, the Slack restore,
   the OAuth clients still on staging, foreign keys validated, timings.

### Reading the logs

The job's logs are routed to their own log bucket, `f3-staging-refresh`
(kept 30 days), which is all a runner can read: no other job's or app's
logs. From a terminal:

```bash
gcloud logging read 'resource.labels.job_name="f3-staging-refresh"' \
  --project f3data --bucket f3-staging-refresh --location global --view _AllLogs \
  --freshness 1d --order asc --format 'value(textPayload)'
```

In the Console: Logs Explorer in project `f3data`, **Refine scope** →
**Log view** → `f3-staging-refresh` / `_AllLogs`. The console link that
`gcloud run jobs execute` prints opens the project's default scope, which a
runner may not be able to read. Only runs after the bucket's sink was
created (by `setup.sh`) are in the bucket.

Each step starts with `== N/12`. The last line says how it ended:

| Last line                                            | Meaning                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `STAGING REFRESH: OK`                                | Done.                                                                                          |
| `STAGING REFRESH DRY RUN: OK`                        | The dry run found nothing that would stop a real run.                                          |
| `STAGING REFRESH FAILED — staging was not changed.`  | It stopped before touching staging. The reason is just above (`!! STOPPED: …`).                |
| `STAGING REFRESH FAILED — staging was rolled back …` | The load failed and staging was put back exactly as it was, keys and Slack included.           |
| `STAGING REFRESH FINISHED WITH PROBLEMS`             | Staging has the new data, but something listed needs a look (e.g. an FK that didn't validate). |
| `ROLLBACK FAILED`                                    | The rare bad case: see below.                                                                  |

The logs never contain row data: counts, table and key names only.

### If it fails

You don't need to clean anything up: either staging wasn't touched, or the
job rolled it back. Common reasons it stops:

| `!! STOPPED:` says                                                         | Do this                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migration gate: prod is at … but staging is at …`                         | Wait until prod and staging run the same release, then run it again.                                                                             |
| `… migration(s) this build's … _journal.json doesn't know`                 | The job's image is older than prod. Ask whoever maintains it to run `tooling/scripts/staging-refresh/setup.sh --image-only` from current `main`. |
| `obfuscate-db failed` with `column(s) nobody has reviewed for PII`         | A migration added a column without classifying it. That needs a code change (see [Review gate](#review-gate)), then a new image.                 |
| `copy and staging tables differ`                                           | Prod and staging have different columns on a table. Usually the same fix as the migration gate: wait for both to run the same release.           |
| `more than one staging API key is named …` / `owner isn't in prod's users` | Fix the key on staging (or the keep list in `staging-refresh.config.ts`) and run again.                                                          |
| `another staging refresh is running`                                       | Someone else started one. Wait for it.                                                                                                           |
| `staging already has schema refresh_keep`                                  | An earlier run's rollback didn't finish. See below.                                                                                              |

**`ROLLBACK FAILED`** means the load failed and putting staging back failed
too (e.g. staging was unreachable), three times. Staging's loaded tables may
be empty, but its own API keys, Slack rows and foreign-key definitions are
safe in the `refresh_keep` / `refresh_keep_slack` / `refresh_keep_fks`
schemas on staging. Load a fresh copy and put them back with:

```bash
gcloud run jobs execute f3-staging-refresh --project f3data --region us-central1 --wait --args=--reuse-existing-stash
```

If that load fails too, its rollback puts staging back as the run found it,
with the `refresh_keep` / `refresh_keep_slack` stash restored exactly (it
may be the only copy of staging's keys), so the same command can be run
again. A normal run keeps refusing until a recovery succeeds.

The staging slackbot restart is best-effort: if the job may not restart it,
the summary prints the `gcloud run services update …` command for someone
with access to `f3-slackbot-staging`.

### Setting it up (once)

`tooling/scripts/staging-refresh/setup.sh`, run by an Owner of `f3data` with
the `spuds` DB logins, creates everything and is safe to re-run. Name who may
run the refresh in the environment (kept out of this public repo):

```bash
STAGING_REFRESH_RUNNERS="user:<operator>@<domain> user:<other>@<domain>" \
  bash tooling/scripts/staging-refresh/setup.sh
```

It creates:

- service account `staging-refresh@f3data.iam.gserviceaccount.com`;
- DB login `staging_refresh`: on prod a plain read-only role
  (`prod-login.sql`: SELECT on `public`/`auth`/`drizzle`/`slackbot`, member of
  nothing, `default_transaction_read_only`), on staging a member of the roles
  that own staging's tables (`staging-login.sql`); passwords in Secret Manager
  (`staging-refresh-prod-db-password`, `staging-refresh-staging-db-password`);
- the job (`tooling/scripts/Dockerfile.staging-refresh`, built with Cloud
  Build into `cloud-run-builds`): 32Gi / 8 CPU (the copy lives in the
  container's in-memory filesystem), 3h timeout, no retries, Cloud SQL
  sockets for both instances;
- execute rights on the job (with `--args`, for `--dry-run`) for the
  members in `STAGING_REFRESH_RUNNERS`, and read access to the job's logs
  only: log bucket `f3-staging-refresh` (30 days), filled by log sink
  `f3-staging-refresh` with
  `resource.type="cloud_run_job" AND resource.labels.job_name="f3-staging-refresh"`,
  and `roles/logging.viewAccessor` conditioned on that bucket's `_AllLogs`
  view. It also removes what its first version made instead: a view on
  `_Default` that showed every Cloud Run job's logs, and its bindings.

Re-run it with `--image-only` after any release that adds a migration, so
the image knows prod's migrations and columns. It prints the one permission
it can't grant: restarting the slackbot in `f3-slackbot-staging`.

The job's command is `pnpm -F @acme/scripts staging-refresh`
(`tooling/scripts/src/staging-refresh.ts`), which also runs outside Cloud Run
given `PROD_DATABASE_URL`, `STAGING_DATABASE_URL`, an empty
`INTERMEDIATE_DATABASE_URL`, `OBFUSCATION_SALT` and pg_dump/pg_restore 18:

```bash
pnpm -F @acme/scripts staging-refresh -- --allow-staging-db f3_staging --dry-run
pnpm -F @acme/scripts staging-refresh -- --allow-staging-db f3_staging --yes
```

## Pipeline design

```text
 ┌───────────┐  pg_dump   ┌──────────────────────────┐  pg_dump   ┌────────────────┐
 │  f3data   │ ─────────► │  intermediate instance    │ ─────────► │ f3data-nonprod │
 │  (prod)   │  (export)  │  (locked-down, ephemeral) │  (load)    │   (staging)    │
 └───────────┘            │  obfuscate-db.ts runs     │            └────────────────┘
                          │  HERE, never on prod      │
                          └──────────────────────────┘
```

The job automates exactly this; the notes below are why each step is the way
it is, learned on the hand-run refreshes.

1. **Export**: `pg_dump` the prod database (`f3data`). The dump itself is
   prod-classified data — treat it like production. The job keeps it inside
   its container and deletes it as soon as it is restored.
2. **Obfuscate on an intermediate instance** — never in place on prod, and
   never directly on staging (a failed half-run must not leave un-obfuscated
   PII in a lower environment). The job uses a throwaway Postgres 18 inside
   its own container (citext and the `auth`/`drizzle` schemas created first;
   `already exists` errors from the restore are expected). The copy must not
   be _ahead_ of the code that classifies it: the job compares prod's applied
   migrations with the image's `packages/db/drizzle/meta/_journal.json`.
3. **Load** the _obfuscated_ copy into `f3data-nonprod`. Learned on the
   first real run (2026-09-22):
   - **Match staging's migration level**, not the repo's. Staging's
     `drizzle.__drizzle_migrations_<db>` says where it is; obfuscate the copy
     at that level and do not migrate it further.
   - **Dump only `public`, `auth` and `drizzle` from prod.** Prod also has
     `codex`, `regionpages` and `temp`; `codex.user_submissions` and
     `codex.admins` hold names and emails this script does not classify.
   - **Load data only** into staging's existing tables. Its schemas belong
     to several roles (`dev_generic`, `tackle`, `app_auth`) whose grants the
     other apps need; a drop-and-restore loses them. Skip any prod table
     staging doesn't have.
   - **Leave staging's OAuth client registrations alone** (`PRESERVED_TABLES`
     in `tooling/scripts/src/staging-refresh.config.ts`). Staging registers
     its own clients (`f3-admin-staging`, `f3-me-staging`); loading the
     copy's revoked rows broke admin login on 2026-09-24. Both generations
     are kept: the legacy `auth.oauth_clients` / `auth.oauth_client`, and
     Better Auth's (the active auth path) as a unit:
     `auth.better_auth_oauth_client`, `auth.better_auth_oauth_resource` and
     `auth.better_auth_oauth_client_resource`, which points at both. The
     token, consent and assertion tables that point at clients are loaded
     from the copy, where the obfuscator empties them; the job refuses to
     load if one isn't empty.
   - **Fix kept rows that point at loaded ones.** A staging client's
     `better_auth_oauth_client.user_id` names a staging user the copy doesn't
     have. After the load the job sets it NULL (what the FK's own `ON DELETE
SET NULL` would do; the summary gives the count) and keeps the old
     value in `refresh_keep_fks` so a rollback can put it back. Kept tables
     are never truncated. An FK from a kept table into a loaded one that
     isn't a single nullable `ON DELETE SET NULL` column is refused at plan
     time, and the verify harness checks the preserve list against the
     schema at head on every PR.
   - **Back up staging's data first** (`pg_dump -Fc -a` of the tables about
     to be loaded): the job restores it automatically if anything fails
     after the truncate.
   - **Stash staging's own API keys and Slack data first**, or every service
     key (the map's `F3_MAP_API_KEY`, the slackbot's, the auth app's) is gone
     and the map serves 401s, and the staging slackbot's workspace (App
     Pioneers) loses its install. Prod's Slack tables are never loaded: the
     obfuscator empties them. `staging-slack` also stashes staging's
     F3versary delivery runs (`slackbot` schema, not their pages); empty the
     runs and pages with the Slack tables during the load, since their FKs
     reference `slack_spaces` and `orgs`. The values never leave the database:

     ```bash
     pnpm -F @acme/scripts staging-api-keys -- --allow-db <staging-db-name> --stash
     pnpm -F @acme/scripts staging-slack -- --allow-db <staging-db-name> --stash
     ```

   - **Drop the foreign keys around the load** (`orgs` and `events` have
     circular FKs, and the Cloud SQL roles can't disable triggers). Save
     them with `pg_get_constraintdef`, truncate, `pg_restore --data-only`
     with `PGOPTIONS='-c app.disable_ao_count_trigger=true'`, then re-add
     them `NOT VALID` and `VALIDATE CONSTRAINT` one at a time. Re-adding
     them validated in one transaction took over an hour and lost its
     connection. (A shell loop around `docker run -i` once validated 1 of 74:
     the container ate the loop's input. The job checks validated == total.)
   - **Reset every serial/identity sequence** to `max(id)` and `ANALYZE`
     only the loaded tables (a bare `ANALYZE` spews permission warnings on
     the system catalogs).
   - After the load, put back **only the service keys**, named with one
     `--keep` each. Every other stashed key (ad-hoc test keys, anything with
     nation admin that nobody owns up to) is dropped, so it doesn't outlive
     the refresh. `--restore` without `--keep` lists the stashed keys (names,
     owners, grant counts, never values) and changes nothing. Names aren't
     unique: a `--keep` name that matches more than one stashed key is
     refused, so pick the right one with `--keep-id <id>` from that list.
     Each kept key keeps its owner id (ids carry over from prod);
     `--owner-email` re-owns them all if an owner is gone:

     ```bash
     pnpm -F @acme/scripts staging-api-keys -- --allow-db <staging-db-name> --restore \
       --keep "<map key name>" --keep "<slackbot key name>" --keep "<auth key name>"
     ```

   - Then put staging's Slack data back. An id only means the same row
     across a refresh if the row behind it is the same, so a workspace's org
     link (and an F3versary run) comes back only when the loaded org with
     that id still has the same name and type; anything else is listed to
     relink by hand. Every Slack member comes back unlinked (`user_id` NULL)
     with the profile the staging slackbot writes (sink email, placeholder
     name, no avatar, no Strava link or metadata): staging's users can't be told apart from the loaded
     copy's, and a real profile synced before the slackbot's non-prod privacy
     change must not survive. The slackbot creates a fresh synthetic user for
     each member on their next action. F3versary runs come back without
     their pages, which hold the announcement text and name members (real
     names, if posted before the privacy change); a run that was still
     delivering comes back `abandoned`. The bot only reads a run's pages
     while it is `planned` and skips a day that already has any other run,
     so the restored runs stop it re-announcing those days and nothing
     stashed can be posted. **Restart the staging slackbot afterwards** so
     it drops its cached links:

     ```bash
     pnpm -F @acme/scripts staging-slack -- --allow-db <staging-db-name> --restore
     ```

     The Slack step is its own script so it can be deleted outright when F3
     moves off Slack.

4. **Sign in as anyone.** Every address is rewritten onto one shared
   Google Group, `dev.staging-email-sink@f3nation.com`, plus-addressed
   per row: a user's email is `dev.staging-email-sink+<users.id>@f3nation.com`.
   Sign in to staging with any user's id-based address (e.g. `+4` for user 4) and the code lands in the group. Staging's system email (map change
   requests, region notifications) reaches the group too, so it can be
   audited end to end. No accounts are fabricated, so there is nothing to
   drift when orgs change. `--email-sink` points it at a different group.

5. **Destroy** the intermediate instance and both the raw and intermediate
   dumps. Only the obfuscated dump may outlive the run.

The seed for per-PR preview databases (`.github/workflows/preview-env.yml`)
currently uses the synthetic local seed (`packages/db/src/local-seed.ts`).
Once this pipeline is approved and running, the preview seed switches from
synthetic data to this pipeline's obfuscated output, giving previews
production-shaped data with zero PII.

## Running the obfuscator by hand

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

| Guard                                                                                                                                                                                     | What it protects against                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--allow-db <name>` must exactly match the database name in `DATABASE_URL` **and** the server-reported `current_database()`                                                               | Pointing the script at the wrong database (e.g. a stale `DATABASE_URL` in a shell or `.env` aimed at prod). The operator has to name the intended target explicitly. |
| `--i-understand-this-rewrites-data`                                                                                                                                                       | Muscle-memory / copy-paste runs. There is no way to run destructively without typing an explicit acknowledgement.                                                    |
| The exact production database name (`f3data`) or any name with `prod`/`production` as a `-`/`_`-delimited token (e.g. `f3_prod`, `prod-copy`; not `f3data-nonprod`) is **always refused** | Even a fully-flagged run cannot execute against anything named like production. Obfuscate a copy, never the source.                                                  |
| `--dry-run`                                                                                                                                                                               | Full report of tables/columns/row counts with zero writes — run this first, always.                                                                                  |

`--preserve-local-seed` additionally keeps the committed local dev fixtures
(`*@f3local.dev` users, `local-*` API keys, `*-local` OAuth clients) intact so
a sandbox database stays usable for local login after obfuscation. It is
**not** used for the staging refresh — prod has no such rows.

### Determinism

Users are rebuilt from their id; everything else is derived from
`sha256(salt + input)` with the required `OBFUSCATION_SALT` secret, so:

- a user's email maps to the same fake **everywhere**: in `users.email`,
  `update_requests.submitted_by`, and inside a JSON `meta` blob it becomes
  `dev.staging-email-sink+<users.id>@f3nation.com`, preserving
  relational/analytical consistency;
- repeated refreshes are diff-friendly (same prod value → same staging value
  across runs, as long as the salt doesn't change).

Formats (sink = `dev.staging-email-sink@f3nation.com`):

| Value                                                                            | Becomes                                                                 |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `users.f3_name` / `first_name` / `last_name`                                     | `F3 <id>` / `First <id>` / `Last <id>` (nulls stay null)                |
| a user's email, anywhere                                                         | `sink+<users.id>`                                                       |
| a non-user email on a row (org, location, event, event instance, update request) | `sink+<table>-<row id>`, e.g. `+org-12`, `+event-34`, `+request-<uuid>` |
| a non-user email in free text                                                    | `sink+ext-<hash8>`                                                      |
| other names (hospital names)                                                     | `F3 User <hash6>`                                                       |

Phones → `555-<hash3>-<hash4>`, Slack IDs in free text →
`Uf3<hash8>` in lowercase hex (lengthened on collision). Real Slack IDs are
uppercase only, so a fake can never be mistaken for one: the verify suite
counts every uppercase-form mention as a leak. Free-text contact/emergency fields are
nulled. Prose (backblasts, preblasts, descriptions) is replaced with
deterministic lorem ipsum. Other JSON/meta and free-text columns are scrubbed
of email-shaped strings and phone numbers by regex, replaced with the same
deterministic fakes.

## PII inventory

Classification legend — **OBFUSCATE**: deterministic fake; **SCRUB**: regex
replacement of email-shaped strings, phone numbers (a 3-3-4 digit run with
separators, e.g. `(704) 555-1234`; bare digit runs such as Slack timestamps are
left alone) **and Slack mention syntax** with deterministic fakes; **REPLACE (lorem)**: the whole value replaced with
deterministic lorem ipsum (below); **NULL OUT**: set to NULL; **TRUNCATE/DELETE**: rows
removed (secrets don't belong in staging); **REWRITE**: not PII, but a prod
URL repointed at its staging equivalent; **KEEP**: non-PII, left untouched.

> **Why prose is REPLACED, not scrubbed.** SCRUB is regex-based: it removes
> email-shaped strings and Slack mentions (`<@U…>`, the pipe form
> `<@U…|display name>`, enterprise-grid `W…` ids) but not names written as
> plain words. The slackbot writes exactly that: a `backblast` body is
> assembled as `Q: {q_name} … PAX: {pax_names} …` from `users.f3_name`
> (`apps/slackbot/features/backblast.py`), and with `attendance.user_id`
> preserved the fake↔real mapping would be joinable by anyone reading it. So
> the prose columns (`obfuscate-db.lorem.ts`, `PROSE_COLUMNS`) are replaced
> outright with lorem ipsum: about the same length, the same line breaks and
> blank lines, NULL and empty left as they are, and deterministic (seeded from
> the salted hash of table, row and column), so refreshes are stable.
> verify-target fails if any word in those columns is outside the lorem
> vocabulary, or a mention or link element survives in the Block Kit ones.
> SCRUB still covers the other free text (`meta`, websites, instance names,
> position/achievement descriptions), where names aren't expected; read
> those rows as "de-identified for emails, phone numbers and Slack ids".
> verify-target sweeps every text/json column for all three.

### `public` schema

| Table                                                                                                                                          | Column(s)                                                    | Classification             | Notes                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                                                                                                                                        | `email`                                                      | OBFUSCATE (email)          | Unique; deterministic hash keeps FKs-by-email consistent                                                                                                                                                                                                                                                                                                                    |
| `users`                                                                                                                                        | `f3_name`, `first_name`, `last_name`                         | OBFUSCATE (name)           |                                                                                                                                                                                                                                                                                                                                                                             |
| `users`                                                                                                                                        | `phone`                                                      | OBFUSCATE (phone)          |                                                                                                                                                                                                                                                                                                                                                                             |
| `users`                                                                                                                                        | `avatar_url`                                                 | NULL OUT                   | Personal photo URL                                                                                                                                                                                                                                                                                                                                                          |
| `users`                                                                                                                                        | `emergency_contact`, `emergency_phone`, `emergency_notes`    | NULL OUT                   | Highly sensitive free text                                                                                                                                                                                                                                                                                                                                                  |
| `users`                                                                                                                                        | `meta` (json)                                                | SCRUB                      | May carry emails/free text                                                                                                                                                                                                                                                                                                                                                  |
| `users`                                                                                                                                        | `email_verified`, `status`, `home_region_id`, ids/timestamps | KEEP                       |                                                                                                                                                                                                                                                                                                                                                                             |
| `slack_spaces`, `slack_users`, `orgs_x_slack_spaces`                                                                                           | all                                                          | TRUNCATE                   | Not replicated: prod's workspaces are no use on staging, and the staging slackbot acts on what it finds. Staging keeps its own rows (`staging-slack`, step 3)                                                                                                                                                                                                               |
| `orgs`                                                                                                                                         | `email`                                                      | OBFUSCATE (email)          | Region/AO contact inboxes are often personal                                                                                                                                                                                                                                                                                                                                |
| `orgs`                                                                                                                                         | `phone`                                                      | OBFUSCATE (phone)          |                                                                                                                                                                                                                                                                                                                                                                             |
| `orgs`                                                                                                                                         | `description`                                                | REPLACE (lorem)            | Free text; names survive any regex. Deterministic lorem ipsum, see below                                                                                                                                                                                                                                                                                                    |
| `orgs`                                                                                                                                         | `meta` (json)                                                | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `orgs`                                                                                                                                         | `website`                                                    | SCRUB                      | Real-data finding (2026-07-10): "website" fields carry typed-in emails                                                                                                                                                                                                                                                                                                      |
| `orgs`                                                                                                                                         | `twitter`, `facebook`, `instagram`, `logo_url`               | KEEP                       | Public org presence                                                                                                                                                                                                                                                                                                                                                         |
| `locations`                                                                                                                                    | `email`                                                      | OBFUSCATE (email)          |                                                                                                                                                                                                                                                                                                                                                                             |
| `locations`                                                                                                                                    | `description`                                                | REPLACE (lorem)            |                                                                                                                                                                                                                                                                                                                                                                             |
| `locations`                                                                                                                                    | `meta` (json)                                                | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `locations`                                                                                                                                    | address/lat/lon                                              | KEEP                       | Public workout locations                                                                                                                                                                                                                                                                                                                                                    |
| `locations`                                                                                                                                    | rows only private events use                                 | DELETE                     | A location with at least one event (series or instance) where every event is private is likely a private residence. It's deleted and its references (`events`, `event_instances`, `update_requests`, `orgs.default_location_id`, all nullable) are set to NULL, so the private events stay without a location. Locations with no events, or with any public event, are kept |
| `events`                                                                                                                                       | `email`                                                      | OBFUSCATE (email)          | Event contact                                                                                                                                                                                                                                                                                                                                                               |
| `events`                                                                                                                                       | `description`                                                | REPLACE (lorem)            |                                                                                                                                                                                                                                                                                                                                                                             |
| `events`                                                                                                                                       | `meta` (json)                                                | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `event_instances`                                                                                                                              | `email`                                                      | OBFUSCATE (email)          |                                                                                                                                                                                                                                                                                                                                                                             |
| `event_instances`                                                                                                                              | `description`, `preblast`, `backblast`                       | REPLACE (lorem)            | Free text authored by users; a backblast is `Q: {q_name} … PAX: {pax_names}`, so it names people                                                                                                                                                                                                                                                                            |
| `event_instances`                                                                                                                              | `preblast_rich`, `backblast_rich`                            | REPLACE (lorem, Block Kit) | Slack Block Kit: every `text` / `alt_text` string becomes lorem; `user`, `usergroup`, `channel` and `link` elements become plain lorem text; block types, ids, styles and emoji are kept, then the usual SCRUB runs over the rest                                                                                                                                           |
| `event_instances`                                                                                                                              | `meta` (json)                                                | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `update_requests`                                                                                                                              | `submitted_by`, `reviewed_by`                                | OBFUSCATE (email)          | Submitter/reviewer contact                                                                                                                                                                                                                                                                                                                                                  |
| `update_requests`                                                                                                                              | `event_contact_email`, `location_contact_email`              | OBFUSCATE (email)          |                                                                                                                                                                                                                                                                                                                                                                             |
| `update_requests`                                                                                                                              | `event_description`, `location_description`                  | REPLACE (lorem)            |                                                                                                                                                                                                                                                                                                                                                                             |
| `update_requests`                                                                                                                              | `ao_website`                                                 | SCRUB                      | Website field carries typed-in emails (see `orgs.website`)                                                                                                                                                                                                                                                                                                                  |
| `update_requests`                                                                                                                              | `event_meta`, `meta` (json)                                  | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `update_requests`                                                                                                                              | `token`                                                      | REGENERATE                 | Capability token mailed to submitters — new random UUID                                                                                                                                                                                                                                                                                                                     |
| `expansions`                                                                                                                                   | `user_lat`, `user_lon`                                       | OBFUSCATE (coarsen ~11km)  | User-submitted home coordinates                                                                                                                                                                                                                                                                                                                                             |
| `expansions`                                                                                                                                   | `area`, `pinned_lat`, `pinned_lon`                           | KEEP                       | Proposed public location                                                                                                                                                                                                                                                                                                                                                    |
| `expansions_x_users`                                                                                                                           | `notes`                                                      | NULL OUT                   | Free text                                                                                                                                                                                                                                                                                                                                                                   |
| `attendance`                                                                                                                                   | `meta` (json)                                                | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `positions`                                                                                                                                    | `description`                                                | SCRUB                      | Names are role titles (Nant'an, Site Q) — KEEP                                                                                                                                                                                                                                                                                                                              |
| `achievements`                                                                                                                                 | `description`, `meta` (json)                                 | SCRUB                      |                                                                                                                                                                                                                                                                                                                                                                             |
| `auth_sessions`                                                                                                                                | all                                                          | TRUNCATE                   | Live session tokens                                                                                                                                                                                                                                                                                                                                                         |
| `auth_verification_tokens`                                                                                                                     | all                                                          | TRUNCATE                   | Magic-link tokens                                                                                                                                                                                                                                                                                                                                                           |
| `auth_accounts`                                                                                                                                | all                                                          | TRUNCATE                   | OAuth refresh/access/id tokens per user                                                                                                                                                                                                                                                                                                                                     |
| `api_keys`                                                                                                                                     | all                                                          | DELETE                     | Live API secrets; cascades `roles_x_api_keys_x_org`. Staging gets its own keys. With `--preserve-local-seed`, `local-*` keys survive                                                                                                                                                                                                                                        |
| `permissions`, `roles`, `event_types`, `event_tags`, `attendance_types`, join tables (`*_x_*` except `orgs_x_slack_spaces`), `alembic_version` | all                                                          | KEEP                       | Reference data / integer-FK join rows, no PII                                                                                                                                                                                                                                                                                                                               |

### `slackbot` schema

| Table                                                                   | Column(s) | Classification | Notes                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slackbot.f3versary_delivery_runs`, `slackbot.f3versary_delivery_pages` | all       | TRUNCATE       | F3versary's delivery state (migration `0028`). Runs reference `slack_spaces`, and pages hold the announcement text, which names members. Emptied with the Slack tables; staging's own runs are carried across by `staging-slack` (step 3), its pages never are |

The coverage gate covers every table, partitioned table and materialized view
in every non-system schema (not just `public` and `auth`), so a new schema
stops the run until it's classified here. Excluded: `drizzle` (migration
bookkeeping) and the `refresh_keep*` holding schemas the staging scripts
create.

### `auth` schema (OAuth/OIDC provider, apps/auth)

| Table                                                                                                                                                                            | Column(s)                                                              | Classification          | Notes                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.oauth_authorization_codes`                                                                                                                                                 | all                                                                    | TRUNCATE                | Live auth codes                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.oauth_access_tokens`                                                                                                                                                       | all                                                                    | TRUNCATE                | Live tokens                                                                                                                                                                                                                                                                                                                                                                                          |
| `auth.oauth_refresh_tokens`                                                                                                                                                      | all                                                                    | TRUNCATE                | Live tokens                                                                                                                                                                                                                                                                                                                                                                                          |
| `auth.email_mfa_codes`                                                                                                                                                           | all                                                                    | TRUNCATE                | `email` column + code hashes                                                                                                                                                                                                                                                                                                                                                                         |
| `auth.oauth_clients`                                                                                                                                                             | `client_secret_hash`                                                   | OBFUSCATE (invalidate)  | Overwritten with `revoked:` + the hash of discarded random input: no secret (prod's or a guessed one) authenticates against staging, and the verify suites check the prefix. `*-local` clients survive only with `--preserve-local-seed`                                                                                                                                                             |
| `auth.oauth_clients`                                                                                                                                                             | `redirect_uris`, `allowed_origin`                                      | REWRITE                 | Repointed at staging: known F3 prod hosts map to their `staging.` twin (`auth`/`auth2` → `staging.auth2`), other non-staging `*.f3nation.com` hosts are dropped, third-party and localhost URIs are left alone. Otherwise a flow started in staging hands its code or backchannel logout to production. An F3 `allowed_origin` with no twin becomes `''`                                             |
| `auth.oauth_clients`                                                                                                                                                             | `id`, `name`, `scopes`                                                 | KEEP                    | Client config, no PII                                                                                                                                                                                                                                                                                                                                                                                |
| `auth.user`                                                                                                                                                                      | `name`, `f3_name`, `hospital_name`                                     | OBFUSCATE (name)        | Real names / hospital                                                                                                                                                                                                                                                                                                                                                                                |
| `auth.user`                                                                                                                                                                      | `email`                                                                | OBFUSCATE (email)       |                                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.user`                                                                                                                                                                      | `id` (email-as-id)                                                     | OBFUSCATE (email-as-id) | This legacy table keys users by email address, so the PK itself is PII (real-data finding 2026-07-10); rewritten through the same deterministic map as `email`                                                                                                                                                                                                                                       |
| `auth.user`                                                                                                                                                                      | `image`                                                                | NULL OUT                | Avatar URL                                                                                                                                                                                                                                                                                                                                                                                           |
| `auth.user_profiles`                                                                                                                                                             | `hospital_name`                                                        | OBFUSCATE (name)        |                                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.oauth_client` (singular)                                                                                                                                                   | `client_secret`                                                        | OBFUSCATE (invalidate)  | Legacy plaintext secret; overwritten the same way (`revoked:` + random hash)                                                                                                                                                                                                                                                                                                                         |
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
| `auth.better_auth_oauth_client`                                                                                                                                                  | `client_secret`                                                        | OBFUSCATE (invalidate)  | Same treatment as `auth.oauth_clients` (`revoked:` + random hash). Rows are KEPT so staging still has its client registrations                                                                                                                                                                                                                                                                       |
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
- **Sessions don't survive a refresh.** Truncating `better_auth_session` /
  `_account` / `_verification` logs everyone out. Sign back in as any user
  through the shared sink (step 4 of the pipeline).

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
   and a backblast with embedded emails, a Slack user with Strava tokens,
   and a Slack workspace with a bot token linked to a region.
3. Runs the obfuscator (without `--preserve-local-seed`), then asserts:
   - **zero** email-shaped strings in any text/json column of the `public`
     and `auth` schemas except `dev.staging-email-sink+<tag>@f3nation.com`;
   - every user is renamed to `F3/First/Last <id>` and emailed at `sink+<id>`;
   - sessions/tokens/api-key tables and the Slack tables are empty;
   - row counts of all kept tables are unchanged (referential integrity);
   - the same source email maps to the same fake across tables;
   - prose (backblast, preblast, descriptions, Block Kit) is lorem ipsum,
     with the planted names, mentions and links gone, about the same length
     and line breaks, the Block Kit structure and emoji kept; verify-target
     fails, naming the column only, when a real name is put back;
   - attendance FKs still resolve;
   - `staging-api-keys --restore` refuses without `--keep` and then restores
     only the named keys and their grants;
   - `staging-slack` carries a staging workspace, its members and its org
     link across an emptied load, unlinks what no longer resolves, and warns
     about a member that isn't on the sink.
4. Runs `obfuscate-db:verify-target` (below) against the obfuscated sandbox,
   so the real-copy suite is exercised on every PR too.
5. Tears the container down and restores `packages/env/.env`.

CI runs it on every PR (`obfuscate-db-verify` in `.github/workflows/ci.yml`),
so a migration that adds an unclassified table or column fails on its own PR
rather than at the next refresh. The harness also checks, before anything
else, that every column at head is in `obfuscate-db.columns.txt`, and proves
both gates fire (an unclassified table and an unreviewed column each abort the
run with `users` unchanged).

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

## Review gate

No refresh runs on PII nobody has classified. That used to mean a human
reviewing the inventory before every run; it is now enforced by code, and the
human review happens on the pull request that changes the schema:

1. **Tables.** `assertFullCoverage` refuses any table (in any non-system
   schema) that isn't in `TOUCHED_TABLES` or `KEPT_TABLES`.
2. **Columns.** `tooling/scripts/src/obfuscate-db.columns.txt` lists every
   `schema.table.column:data_type` the script has been reviewed against
   (seeded 2026-10-07 from prod's real columns plus everything the migrations
   create at head). The obfuscator refuses, before it writes anything, when
   the target has a column, or a column type, that isn't listed. Before this,
   a new column on a known table was copied to staging as-is.
3. **CI.** `obfuscate-db-verify` migrates a sandbox to head on every PR and
   fails if a column is missing from the snapshot, so a migration that adds a
   column fails on its own PR. To fix it, classify the column in
   `obfuscate-db.ts` and the [PII inventory](#pii-inventory), then add its
   line (`DATABASE_URL=<db migrated to head> pnpm -F @acme/scripts
obfuscate-db -- --update-column-snapshot`). **Reviewers:** a new line in
   the snapshot is a PII decision; check the column's handling, not just the
   line.
4. **The run** refuses unless prod's migrations are all in the image's
   journal (the image is rebuilt from `main` with `setup.sh --image-only`),
   then refuses unless the verify-target suite passes 100% on the copy.

What this does not cover: the gate checks that a column was _reviewed_, not
that the review was right, and SCRUB is regex-based (names in the
non-prose free text it covers would survive; prose itself is replaced, see
above). Legacy `auth.user` /
`auth.user_profiles` exist only on prod, outside the repo's migrations; the
2026-07-10 and 2026-09-22 runs checked their constraints by hand, and their
columns are in the snapshot as they were on 2026-10-07.

The preview-environment seed still uses the synthetic local seed; switching
it to this pipeline's output is a separate change.
