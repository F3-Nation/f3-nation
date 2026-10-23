---
applyTo: ".github/workflows/**,.github/actions/**,.github/scripts/**,.github/preview/**"
---

# GitHub Actions

`AGENTS.md` § GitHub Actions Conventions covers SHA pinning, `.nvmrc`, the
build platform, the setup action and `check-regexp` upkeep. These rules add
security and reliability checks. Apply them to new and changed workflows.

## Security

- Workflows triggered by `pull_request_target` or `workflow_run`, or holding
  secrets, `id-token: write` or a write token, never check out or execute
  untrusted PR-head code (forks, arbitrary branches). That includes local
  actions, `pnpm` scripts and CLI source from the PR tree. Consume the PR as
  data. Gate deploy **and** teardown jobs on the head repo being this repo.
- Minimize new third-party actions. Prefer a shell step, `gh`,
  `actions/github-script`, or an action this repo already uses. A new one
  needs a reason in the PR and a maintained, widely used publisher, and is
  SHA-pinned like the rest.
- Never interpolate `${{ github.event.* }}`, `inputs.*` or `steps.*.outputs`
  into `run:`. Pass them through `env:` and quote them.
- Validate `workflow_dispatch` refs and tags against the workflow's tag prefix
  and an existing tag before checkout.
- Set workflow-level `permissions` to `{}` or `contents: read`. Grant writes
  and `id-token` per job, with a comment, and drop grants a change no longer
  needs.
- Set `persist-credentials: false` on checkouts that only read.
- Scope secrets to the step that needs them, never job-level `env`.
- Minted tokens and keys expire no later than the job timeout.
- Guard scheduled workflows that need this repo's alerts or cloud credentials
  with `if: github.repository_owner == 'F3-Nation'`; forks can enable the
  schedule.
- Never commit high-entropy strings, even fake credentials, because secret
  scanners flag them. Build mock values at runtime.
- CI service images come from this repo's GHCR mirror
  (`mirror-postgres-image.yml`), not Docker Hub. Keep the package public:
  fork PRs can't pull private packages, even when the job logs in.

## Reliability

- Only use real `on:` events. A misspelled or unsupported event never runs and
  never fails.
- Gates fail closed:
  - Assert on outputs (task count, `git diff`, HTTP status), not the exit
    code of tools that can exit 0 on failure.
  - Look up tags and digests with exact matches.
  - Treat only a 404 as "not found".
  - Set `shell: bash` or `set -o pipefail` around scans: the default shell is
    `bash -e`, without `pipefail`.
- Steps after a successful prod deploy (cache warm, notify) are non-fatal.
  Guard every command, because the default shell aborts on the first failure.
- `curl` sets `--connect-timeout` and `--max-time`. Cleanup calls retry
  boundedly.
- REST automation is idempotent:
  - Tolerate a 422 "already exists" on create and a 404 on remove.
  - Re-read live state instead of trusting the event payload.
  - Filter PRs out of issue lists, and paginate.
- Add a `concurrency` group to read-then-write jobs. Never use
  `cancel-in-progress` on release or deploy jobs.
- Label-mutating workflows can retrigger others (preview deploys cost money),
  so gate on the specific label.
- Renaming or adding a required check must also update `docs/CI_PIPELINE.md`.
  Flag a change that touches only the workflow or only the doc.
- Check environment protection rules before adding a trigger. A deployment
  environment's branch or tag policy can make a new path undeployable.
- Don't demand a test harness for short inline `run:` or `github-script`
  steps; extract logic into a tested script only when it branches.
- Upload logs on `failure() || cancelled()`, and write job summaries in
  `finally`.
