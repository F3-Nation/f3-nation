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

## Cloud and repository changes

Every manual change the release needs gets three blocks:

1. **The change,** as a targeted command for just that setting (for an env
   var, `gcloud run services update … --update-env-vars` or
   `--remove-env-vars`; values with commas use gcloud's `^DELIM^` syntax).
   Never a helper that pushes every setting from a local file.
2. **A check** that reads the setting back and prints true or false, and
   also checks the service serves its latest revision when the change makes
   a new one.
3. **A rollback** in "If something goes wrong", or beside the change when
   it's in the optional "Later" step.

When the order matters (a setting the new app needs, a domain moving
between services), the step says when to run it and what's broken in
between.

## Deploy approvals

Approve from the terminal with the run IDs in `pending_deploys`, one loop per
group that's approved together, then wait on the same runs:

```bash
for RUN in 111 222; do
  ENV_ID=$(gh api repos/<owner>/<repo>/actions/runs/$RUN/pending_deployments --jq '.[0].environment.id')
  gh api -X POST repos/<owner>/<repo>/actions/runs/$RUN/pending_deployments \
    -F "environment_ids[]=$ENV_ID" -f state=approved -f comment="Release #<number>" --silent \
    && echo "approved $RUN: true" || echo "approved $RUN: false"
done
for RUN in 111 222; do
  gh run watch "$RUN" -R <owner>/<repo> --exit-status >/dev/null 2>&1 \
    && echo "run $RUN green: true" || echo "run $RUN green: false"
done
```

(The `<…>` here are for the skill to fill in when it writes the plan; the
plan itself has real values.) One run can hold several jobs waiting on the
same environment; one approval releases all of them. Also link the Actions
page for anyone who'd rather click.

## Rollback

Rolling an app back sends traffic to the revision before the release:

```bash
SERVICE=service-name PROJECT=project-id
gcloud run revisions list --service "$SERVICE" --project "$PROJECT" --region us-central1 --limit 3 \
  --format='table(metadata.name,metadata.creationTimestamp)'
REV=paste-the-revision-before-this-release
gcloud run services update-traffic "$SERVICE" --project "$PROJECT" --region us-central1 --to-revisions "$REV=100"
```

Traffic then stays on that revision until `--to-latest` sends it back. Say
which apps must not be rolled back once a migration has run, and why.
