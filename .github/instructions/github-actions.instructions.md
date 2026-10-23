---
applyTo: ".github/workflows/**,.github/actions/**,.github/scripts/**,.github/preview/**"
---

# GitHub Actions

`AGENTS.md` § GitHub Actions Conventions covers SHA pinning, `.nvmrc`, the
build platform and the setup action. The rules below add security and
reliability checks.

## Security

- Workflows triggered by `pull_request_target` or `workflow_run`, or holding
  secrets, `id-token: write` or a write token, never check out or execute
  PR-head code. That includes local actions, `pnpm` scripts and CLI source
  from the PR tree. Gate deploy **and** teardown jobs on the head repo being
  this repo.
- Never interpolate `${{ github.event.* }}`, `inputs.*` or `steps.*.outputs`
  into `run:`. Pass them through `env:` and quote them.
- Validate `workflow_dispatch` refs and tags against the workflow's tag prefix
  and an existing tag before checkout.
- Declare `permissions: {}` at workflow level. Grant each job only what it
  uses, with a comment, and remove permissions a change no longer needs.
- Set `persist-credentials: false` on checkouts that only read.
- Scope secrets to the step that needs them, never job-level `env`.
- Minted tokens must expire no later than the job timeout.
- Scheduled workflows run in forks too, so guard them with
  `if: github.repository == 'F3-Nation/f3-nation'`.
- Never commit high-entropy strings, even fake credentials. Build mock values
  at runtime.
- CI service images come from the public GHCR mirror, because fork PRs can't
  pull private packages.

## Reliability

- Only use real trigger events, and check the name exists. A misspelled
  `on:` event never runs and never fails.
- Gates must fail closed:
  - Assert on outputs (task count, `git diff`, HTTP status), not on a tool's
    exit code, for tools that can exit 0 on failure.
  - Look up tags and digests with exact matches.
  - Treat only a 404 as "not found".
  - Use `set -o pipefail` around scans.
- Steps after a successful prod deploy (cache warm, notify) are non-fatal.
  Guard every command, because the default shell is `bash -eo pipefail`.
- `curl` calls set `--connect-timeout` and `--max-time`. Cleanup calls retry
  boundedly.
- REST automation is idempotent:
  - Tolerate a 422 "already exists" on create and a 404 on remove.
  - Re-read live state instead of trusting the event payload.
  - Filter out PRs when listing issues, and paginate.
- Add a `concurrency` group to read-then-write jobs. Never use
  `cancel-in-progress` on release or deploy jobs.
- Label-mutating workflows can retrigger others (preview deploys cost
  money), so gate on the specific label.
- Renaming or adding a required check must also update every deploy
  `check-regexp`, `docs/CI_PIPELINE.md` and the list in `AGENTS.md`. Flag a
  rename that touches only one of them.
- Check environment protection rules before adding a trigger. A deployment
  environment's branch or tag policy can make a new path undeployable.
- Upload logs on `failure() || cancelled()`, and write job summaries in
  `finally`.
