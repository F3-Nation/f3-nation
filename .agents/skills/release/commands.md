# Writing the commands in a release plan

The person running a release plan copies each command, runs it, and reads one
word back. These rules make that work.

## Blocks

- Every command the person runs is in a fenced block (`bash` or `sql`),
  indented under its checklist item, never inline in a sentence. One block per
  thing that runs at once; a block that must only run after another printed
  `true` says so in a line above it.
- Write real values in: the release commit, run IDs, project and service
  names, database names, file names. The person never looks a value up.
- Never put `<placeholder>` text inside a shell command: the shell reads `<`
  and `>` as redirects. When the person must supply a value, give it its own
  line, `NAME=paste-the-value-here`, and use `"$NAME"` below it.
- A shell block runs from the repository root unless it says otherwise, and
  never prints a secret: read a secret only to test it exists
  (`… >/dev/null && echo …`).

## Checks print true or false

Every check prints `true` or `false` (`t` or `f` in `psql`), with a short
label when one block prints several, so nothing is compared by eye. The
step's **Expected** and **Stop if** lines name the output.

- A command that succeeds or fails:
  `some-command && echo "label: true" || echo "label: false"`.
- Comparing a value, such as a commit hash or a file name:
  `test "$(some-command)" = expected-value && echo "label: true" || echo "label: false"`.
- Finding text in a download or other output: capture it first, then match,
  `OUT=$(curl -fsS https://…) && grep -q 'pattern' <<<"$OUT" && echo "label: true" || echo "label: false"`.
  Never pipe it into `grep -q`: grep exits at the first match, the writer
  then fails on the closed pipe (`curl: (23)`), and under `pipefail` the
  check prints `false` for a page that matched.
- A Cloud Run, GitHub or other JSON setting: pipe the read-only `describe`
  or `api` call to `jq '<boolean expression>'`, comparing against the exact
  expected value.
- A wait (a deploy, a workflow run, a certificate): a command that blocks
  until it finishes and exits non-zero on failure (`gh run watch <id>
--exit-status`), or a loop with an upper bound that prints the result, never
  an open-ended loop.

## Database blocks

- Each block starts with `SET default_transaction_read_only = on;` unless
  it's the migration itself, and its first check is
  `SELECT current_database() = '<database>' AS right_database;`.
- Combine a step's checks into one row: each detail as its own column and an
  `all_ok` column that is true only when every detail is as expected. A
  comment above the query names what to expect.
- Put each query in the step that runs it, never in a section at the end.
- Grant checks read the explicit grants (`aclexplode(relacl)` for objects,
  `pg_default_acl` for what new objects will get) for the logins that use the
  object. Effective-privilege functions such as `has_table_privilege` answer
  through role membership, and app logins can belong to broad roles, so they
  pass whatever was granted.
- A row backup writes exactly the rows the migration changes, to a file name
  that says the database and migration, followed by a shell check that the
  file starts with the table's header and a `chmod 600`.

### The migration login's default privileges

When a migration creates a table or sequence, the pre-checks include this
check: the apps reach what `db_migrator` creates only through its default
privileges ([`docs/db-migrations.md`](../../../docs/db-migrations.md),
"New objects"). `logins` lists the app logins that use the schema, with
`required` false for one that may not exist on that database; the ones below
are `public`'s. `missing_logins` names each login that lacks the table DML or
sequence `USAGE` default, so a `f` says what to fix:

```sql
-- Expect: migrator_defaults_ok = t and missing_logins = {}.
WITH logins AS (
  SELECT n AS name, to_regrole(n) AS role, required
  FROM (VALUES ('map', true), ('app_auth', true), ('f3slackbot', true), ('app_slackbot', false)) v(n, required)),
d AS (
  SELECT a.grantee, d.defaclobjtype AS kind, a.privilege_type AS priv
  FROM pg_default_acl d, aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclrole = 'db_migrator'::regrole),
missing AS (
  SELECT name FROM logins
  WHERE CASE WHEN role IS NULL THEN required ELSE NOT (
    (SELECT count(DISTINCT priv) FROM d WHERE grantee = role AND kind = 'r'
       AND priv IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 4
    AND EXISTS (SELECT 1 FROM d WHERE grantee = role AND kind = 'S' AND priv = 'USAGE')) END)
SELECT NOT EXISTS (SELECT 1 FROM missing) AS migrator_defaults_ok,
  ARRAY(SELECT name FROM missing ORDER BY name) AS missing_logins;
```

Beside the check, give the fix for a login it reports. It runs as the
migration login itself, with the migration step's proxy running:
`ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator` needs membership in
`db_migrator`, and on Production `db_migrator` is already a member of the
operator's role, so granting that membership back is refused as circular.
Interactive, when the check already printed `f`, write the login it named;
otherwise write one block per login in `logins` and say to run only those in
`missing_logins`. Never a placeholder. The block below is a Production
plan's; a Staging plan reads `MIGRATE_DATABASE_URL_STAGING` instead:

```bash
psql "$(gcloud secrets versions access latest --secret=MIGRATE_DATABASE_URL_PROD --project=f3data)" -X -v ON_ERROR_STOP=1 <<'SQL'
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO f3slackbot;
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO f3slackbot;
SQL
```

Then run the check again; it must print `t` before the migration.

## Cloud and repository changes

Every manual change the release needs gets three blocks:

1. **The change,** as a targeted command for just that setting. An env var:
   `gcloud run services update … --update-env-vars` or `--remove-env-vars`
   (values with commas use gcloud's `^DELIM^` syntax). A secret: a new
   Secret Manager version read from a hidden prompt
   (`read -rs VALUE; printf %s "$VALUE" | gcloud secrets versions add NAME --project … --data-file=-`),
   mounted with `--update-secrets KEY=NAME:latest` the way that app's
   `scripts/cloud-run-env.sh` mounts it; never pass a secret through
   `--update-env-vars` or write its value in the issue. Never a helper that
   pushes every setting from a local file.
2. **A check** that reads the setting back and prints true or false (for a
   secret, its mount: `.valueFrom.secretKeyRef`, never the value), and also
   checks the service serves its latest revision when the change makes a new
   one.
3. **A rollback** in "If something goes wrong", or beside the change when
   it's in the optional "Later" step.

When the order matters (a setting the new app needs, a domain moving
between services), the step says when to run it and what's broken in
between.

## Deploy approvals

Approve from the terminal with the run IDs in `pending_deploys`, one block per
group that's approved together. It watches only the runs it approved, and a
run someone already approved on the Actions page counts as approved. While it
watches, it also approves a job of the same run that reaches approval later
(Slackbot's two deploy jobs can arrive at different times), so the watch
never waits on an approval nobody sees. Each run's watch ends after an hour,
or as soon as a read or a later approval fails, and a run that didn't finish
prints `green: false`:

```bash
APPROVED=""
for RUN in 111 222; do
  PENDING=$(gh api repos/<owner>/<repo>/actions/runs/$RUN/pending_deployments) \
    || { echo "approved $RUN: false (read failed)"; continue; }
  ENV_ID=$(printf '%s' "$PENDING" | jq -r '.[0].environment.id // empty')
  if [ -z "$ENV_ID" ]; then
    echo "approved $RUN: true (nothing waiting)"; APPROVED="$APPROVED $RUN"; continue
  fi
  gh api -X POST repos/<owner>/<repo>/actions/runs/$RUN/pending_deployments \
    -F "environment_ids[]=$ENV_ID" -f state=approved -f comment="Release #<number>" --silent \
    && { echo "approved $RUN: true"; APPROVED="$APPROVED $RUN"; } || echo "approved $RUN: false"
done
for RUN in $APPROVED; do
  STATUS=""; DEADLINE=$((SECONDS + 3600))
  while [ "$SECONDS" -lt "$DEADLINE" ] \
    && STATUS=$(gh run view "$RUN" -R <owner>/<repo> --json status --jq .status) && [ "$STATUS" != completed ]; do
    PENDING=$(gh api repos/<owner>/<repo>/actions/runs/$RUN/pending_deployments) \
      || { echo "approved $RUN (later job): false (read failed)"; break; }
    ENV_ID=$(printf '%s' "$PENDING" | jq -r '.[0].environment.id // empty')
    if [ -n "$ENV_ID" ]; then
      gh api -X POST repos/<owner>/<repo>/actions/runs/$RUN/pending_deployments \
        -F "environment_ids[]=$ENV_ID" -f state=approved -f comment="Release #<number>" --silent \
        && echo "approved $RUN (later job): true" \
        || { echo "approved $RUN (later job): false"; break; }
    fi
    sleep 30
  done
  [ "$STATUS" = completed ] \
    && [ "$(gh run view "$RUN" -R <owner>/<repo> --json conclusion --jq .conclusion)" = success ] \
    && echo "run $RUN green: true" || echo "run $RUN green: false"
done
```

(The `<…>` here are for the skill to fill in when it writes the plan; the
plan itself has real values.) One run can hold several jobs waiting on the
same environment; one approval releases all of them. Also link the Actions
page for anyone who'd rather click.

## Rollback

The rollback command is in the template's "If something goes wrong" section
([`plan-template.md`](plan-template.md)). Add after it which apps must not be
rolled back once a migration has run, and why.
