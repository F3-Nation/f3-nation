# .github (workflows, actions, scripts)

Root [`AGENTS.md`](../AGENTS.md) § GitHub Actions Conventions covers SHA
pinning, `.nvmrc`, the build platform, the setup action and `check-regexp`
upkeep. These rules apply to new and changed workflows.

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
- Check environment protection rules before adding a trigger; a deployment
  environment's branch or tag policy can make a new path undeployable.
- Short inline `run:` or `github-script` steps don't need a test harness;
  extract logic into a tested script once it branches.
- Upload logs on `failure() || cancelled()`, and write job summaries in
  `finally`.
