# .github (workflows, actions, scripts)

These rules apply to new and changed files under `.github/`. The
Docker build-platform rule lives in root [`AGENTS.md`](../AGENTS.md#docker-build-platform).

## Workflow conventions

- **Pin third-party actions to a full commit SHA with a version comment** (`<owner>/<action>@<full 40-character commit SHA> # v<version>`). SHAs are immutable — a semver tag can be force-pushed, a SHA cannot. Renovate (`pinDigests: true`) keeps the SHAs up to date automatically.
- Drive the Node version from `.nvmrc` via `actions/setup-node` (`node-version-file: .nvmrc`) — `.nvmrc` is the single source of truth. Never hardcode `node-version:` in a workflow.
- Share toolchain setup through the composite action [`.github/actions/setup`](actions/setup/action.yml) (pnpm + Node + pnpm-store cache + frozen install) instead of repeating setup steps per job.
- The `main` branch ruleset's required status checks are a GitHub setting, and every workflow that waits on them keeps its own copy: each `check-regexp` under `.github/workflows/` (`git grep -l check-regexp .github/workflows` finds them all) and any check-name list beside one, such as the `REQUIRED` env in `rebuild-staging-refresh.yml`. Renaming or adding a required check means updating the ruleset and every copy by hand, and nothing checks that they agree. Every required check except `lint-title` belongs in each copy. A copy may also wait on checks the ruleset doesn't require but its own job depends on; keep those when bringing it in step with the ruleset. `lint-title` is deliberately left out of every copy because it never runs on `push` (`pr-title.yml` triggers only on `pull_request` and `merge_group`), so a commit that reached `main` outside the merge queue has no `lint-title` check-run. A `check-regexp` would skip it, but a check-name list such as `REQUIRED` fails when a named check is missing.

## Security

- Workflows triggered by `pull_request_target` or `workflow_run`, or holding
  secrets, `id-token: write` or a write token, never check out or execute
  untrusted PR-head code (forks, arbitrary branches): no local actions,
  `pnpm` scripts or CLI source from the PR tree. Consume the PR as data, and
  gate deploy **and** teardown jobs on the head repo being this repo.
- Minimize new third-party actions. Prefer a shell step, `gh`,
  `actions/github-script` or an action this repo already uses; a new one
  needs a reason in the PR and a maintained, widely used publisher, and is
  SHA-pinned like the rest.
- A checkout of another repository (`repository:`) pins `ref:` to a full
  commit SHA with a version comment, and needs the same justification as a
  new third-party action; Renovate doesn't track `ref:`, so update it by hand.
  Code from it, built or run, never shares a job with a write token,
  `id-token: write`, or a secret that can deploy, mint keys or spend without a
  cap, even one scoped to a different step: earlier steps can tamper with
  later ones in the same job. If that job needs a provider key, give it a
  spend-capped key in an environment-scoped secret.
- Never interpolate `${{ github.event.* }}`, `inputs.*` or `steps.*.outputs`
  into `run:`; pass them through `env:` and quote them.
- Validate `workflow_dispatch` refs and tags against the workflow's tag prefix
  and an existing tag before checkout.
- New workflows set workflow-level `permissions` to `{}` or `contents: read`
  and grant writes and `id-token` per job with a comment. A change that edits
  an existing `permissions` block moves toward that and drops grants it no
  longer needs; other edits leave existing workflow-level grants alone.
- Set `persist-credentials: false` on checkouts that only read. Scope secrets
  to the step that needs them, never job-level `env`. Minted tokens and keys
  expire no later than the job timeout.
- Guard scheduled workflows that need this repo's alerts or cloud credentials
  with `if: github.repository_owner == 'F3-Nation'`; forks can enable the
  schedule.
- Never commit high-entropy strings, even fake credentials (secret scanners
  flag them); build mock values at runtime.
- CI service images come from this repo's public GHCR mirror
  (`mirror-postgres-image.yml`), not Docker Hub; fork PRs can't pull private
  packages.

## Reliability

- Use only real `on:` events; a misspelled or unsupported event never runs and
  never fails.
- Gates fail closed: assert on outputs (task count, `git diff`, HTTP status)
  rather than the exit code of tools that can exit 0 on failure, look up tags
  and digests with exact matches, treat only a 404 as "not found", and set
  `shell: bash` or `set -o pipefail` around scans (the default shell is
  `bash -e`, without `pipefail`).
- Steps after a successful prod deploy (cache warm, notify) are non-fatal;
  guard every command.
- `curl` sets `--connect-timeout` and `--max-time`; cleanup calls retry
  boundedly.
- REST automation is idempotent: tolerate a 422 "already exists" on create and
  a 404 on remove, re-read live state instead of trusting the event payload,
  filter PRs out of issue lists, and paginate.
- Add a `concurrency` group to read-then-write jobs; never use
  `cancel-in-progress` on release or deploy jobs.
- Label-mutating workflows can retrigger others (preview deploys cost money),
  so gate on the specific label.
- Renaming or adding a required check also updates `docs/CI_PIPELINE.md`.
- A required check's workflow also triggers on `merge_group`, and its job runs
  its checks there; only `lint-title`, which has no PR title to lint on a merge
  group, may skip its steps and report green. A check that never reports holds
  the merge queue until it times out. `merge_group` runs execute queued PR code, forks
  included, so the security rule on secrets and write tokens applies to them.
- Check environment protection rules before adding a trigger; a deployment
  environment's branch or tag policy can make a new path undeployable.
- Short inline `run:` or `github-script` steps don't need a test harness;
  extract logic into a tested script once it branches.
- Upload logs on `failure() || cancelled()`, and write job summaries in
  `finally`.
