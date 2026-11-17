# Expected findings

Open this file only after the findings for every case are final ([`README.md`](README.md) says
why). Each entry is a defect at the case's `head` commit that the author confirmed and fixed
afterwards. The lens is the one most likely to raise it; a catch by any seat counts.

## `map-error-boundary`

- **Important, `tests`** —
  `apps/map/__tests__/app/_components/map/google-maps-auth-failure-boundary.test.tsx`: the
  boundary swallows an error only when it is a `TypeError` and its stack points at Google's
  script, but no test covers the `TypeError` half. The test meant to cover it throws a plain
  `Error` whose stack has no script URL, so the stack check alone re-throws it. Deleting the
  `instanceof TypeError` condition leaves every test passing.

## `issue-fields-script`

- **Important, `correctness` or `failure-paths`** —
  `.agents/skills/issue-triage/scripts/issue-fields.sh`: an App value that has commas but no
  names (such as `,` or `, ,`) is documented as "leave App unchanged", but the script sends an
  empty App list, which clears the issue's App values, then prints success and exits 0.

## `staging-refresh-ci`

- **Important, `access`** — `tooling/scripts/staging-refresh/setup.sh`: the script lets GitHub
  Actions act as the deploy service account before anything checks that the GitHub environment
  the trust is scoped to exists with a main-only branch policy. GitHub creates a missing
  environment unprotected the first time a job names it, so until the environment is set up,
  anyone with write access can run a job from a branch as that account.
- **Important, `docs-truth` or `correctness`** — `.agents/skills/release-plan/SKILL.md`: the
  rule for when a production migration needs the full setup re-run is narrowed to "creates a
  table or enables audit tracking". Migrations that revoke grants, change an owner or create a
  schema also remove the refresh login's access, and an existing migration in the repo does
  the first two.

## `token-rotation-adr`

- **Important, `docs-truth`** — `docs/adr/0005-slack-official-token-rotation.md`: two rules in
  the Decision contradict each other. One says a save never replaces a token with one that
  expires earlier; another moves existing workspaces from tokens that never expire to
  short-lived ones. Read literally, the first rule blocks the second, and the one-time exchange
  would be spent.
