# CI Pipeline — Gate Audit

> What must pass before code reaches `main`, `staging`, and `production`, in order;
> plus the two reserved rungs (per-PR preview environments and a blocking E2E
> tier) that will be added later. This document describes the pipeline as it
> exists today — it changes when the workflows change, and any drift is a bug
> in this doc.

## The chain at a glance

```
PR opened/updated
  │
  ├─ pr-title.yml ······· Conventional-Commit PR title lint
  └─ ci.yml
       ├─ format-check ·· pnpm format (Prettier)             [required to merge]
       ├─ lint ·········· pnpm lint (ESLint)                 [required to merge]
       ├─ typecheck ····· pnpm typecheck (tsc)               [required to merge]
       ├─ build ········· pnpm build (Turbo)                 [required to merge]
       ├─ test-coverage · pnpm test (Vitest vs postgres:18)  [required to merge]
       ├─ security-audit  pnpm audit --prod --level=high    [required to merge]
       ├─ docker-build ·· per-app image build (6 apps)      [advisory]
       ├─ recent-package-watch · npm publish-date report    [advisory, comment]
       │
       ├─ (reserved) preview-env ·· per-PR Cloud Run deploy, opt-in label
       └─ (reserved) e2e-blocking · Playwright critical paths vs preview env
  │
merge to main (ruleset "main": PR required, the six checks above required,
  │            no force-push, no deletion)
  │
release-please.yml ····· accumulates merges into per-app release PRs
  │
tag push (e.g. map@1.2.3) → deploy-<app>.yml → _deploy-cloudrun.yml
       ├─ ci-gate ······· waits for build/lint/typecheck/format-check/
       │                  test-coverage on the tagged SHA
       ├─ build ········· container image built once, pushed to Artifact Registry
       ├─ deploy-staging  Cloud Run (staging project) [+ cache revalidate]
       └─ deploy-prod ··· needs staging success; Cloud Run (prod project)
```

## Gate-by-gate

The required checks run on `pull_request` (any target branch) and on `push` to
`main`. Every job checks out with `persist-credentials: false`; Node-based jobs
use the shared `.github/actions/setup` for pnpm and Node from `.nvmrc`.
Third-party actions are SHA-pinned. The advisory Docker path is event-specific:
PRs validate images with read-only access to the GHCR cache, while a separate
`main`-only job refreshes it with package-write permission.

The five Turbo-backed required checks (`format-check`, `lint`, `typecheck`,
`build`, and `test-coverage`) add `--affected` on pull requests, selecting
changed workspaces and their dependents. Their checkouts include the complete
Git history needed for the base-to-head comparison. Pushes to `main` omit the
flag and validate the full workspace. If Turbo maps a pull request to zero
workspaces (for example, a root-only CI change), setup omits `--affected` and
runs the full workspace so required checks cannot pass without selecting any
tasks. The non-Turbo safeguards in the `lint` job (`lint:ws`,
coverage-threshold validation, Python task validation, and `lint:unused`)
remain repository-wide on every run.

| #   | Gate                   | What it runs                                                                                                                 | What it catches                                                                                                                    | Merge-blocking (`main` ruleset) |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | `format-check`         | `pnpm format` (affected workspaces on PRs; full workspace on `main`)                                                         | Prettier drift                                                                                                                     | ✅                              |
| 2   | `lint`                 | `pnpm lint` (affected workspace ESLint plus repository-wide safeguards on PRs; full workspace on `main`)                     | ESLint violations (incl. security rules)                                                                                           | ✅                              |
| 3   | `typecheck`            | `pnpm typecheck` (affected workspaces and dependents on PRs; full workspace on `main`)                                       | Type errors in changed workspaces and their consumers                                                                              | ✅                              |
| 4   | `build`                | `pnpm build` (affected workspaces and dependents on PRs; full workspace on `main`)                                           | Build breakage in changed workspaces and their consumers                                                                           | ✅                              |
| 5   | `test-coverage`        | `pnpm test` for affected workspaces on PRs or the full workspace on `main`, against `postgres:18`                            | Unit/integration regressions                                                                                                       | ✅                              |
| 6   | `security-audit`       | `pnpm audit --prod --audit-level=high`                                                                                       | Known high/critical vulns in prod deps                                                                                             | ✅                              |
| 7   | `docker-build`         | Per-app `docker build` (admin, api, auth, map, me, slackbot; matrix, `linux/amd64`, no image push, per-app GHCR layer cache) | Breakage specific to the pruned Docker context (catalog mismatches, isolated-linker resolution) that the workspace build can't see | ❌ advisory                     |
| 8   | `recent-package-watch` | npm publish-time report for all workspace deps (same-repo PRs only)                                                          | Supply-chain freshness signal — flags deps published in the last 3 days; upserts a PR comment                                      | ❌ advisory                     |
| —   | `pr-title.yml`         | PR title lint                                                                                                                | Non-Conventional-Commit squash titles                                                                                              | (separate workflow)             |

Local equivalents before pushing: `pnpm format`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `pnpm test` (see [`AGENTS.md`](../AGENTS.md#build-test-and-development-commands)).

## Deploy pipeline (per app)

Merges to `main` don't deploy anything directly. `release-please.yml` maintains
per-app release PRs; merging one pushes a tag like `map@1.2.3`, which triggers
that app's thin `deploy-<app>.yml` caller into the shared
[`_deploy-cloudrun.yml`](../.github/workflows/_deploy-cloudrun.yml):

1. **`ci-gate`** — waits (does not re-run) for
   `build|lint|typecheck|format-check|test-coverage` to succeed on the tagged
   SHA.
2. **`build`** — the deploy image is built once and pushed to Artifact
   Registry.
3. **`deploy-staging`** — Cloud Run in the staging project; optional
   post-deploy cache revalidation.
4. **`deploy-prod`** — requires staging success, then Cloud Run in the prod
   project.

## Observations

- `docker-build` runs on every PR but is **not** in the `main` ruleset's
  required checks — an image-only breakage can merge and will surface at
  release time in the deploy `build` job.
- PR builds receive only `packages: read`: they may import each app's shared
  GHCR cache but cannot update it. Only the `docker-cache-refresh` job on pushes
  to `main` receives `packages: write` and exports new layers. If login or cache
  import fails (including a fork PR without package access), the build retries
  without importing cache, so cache availability remains an optimization
  rather than a correctness dependency. On first rollout, PR builds may run
  uncached until the first merged `main` build creates the cache packages.
- The active `main` ruleset permits squash merges only and requires strict
  status checks. The squash creates a new commit SHA whose push-to-`main` CI run
  performs full-workspace validation, so deploy gates on that full run rather
  than a PR-scoped `--affected` run.
- The deploy `ci-gate` regexp waits on the five build/test checks but not
  `security-audit` (the audit already gated the merge; a tag cut from an
  unmerged or old SHA relies on that earlier gate).
- The two reserved rungs below are the planned homes for end-to-end
  verification, which today has no rung at all.

## Reserved rungs (planned, not yet implemented)

These do not exist yet and are documented for future reference:

- **`preview-env`** — per-PR Cloud Run preview environment, opt-in via a
  `preview` label; scale-to-zero; own seeded database; torn down on PR
  close/merge plus a daily TTL reaper. Slots in as a PR job alongside the
  existing gates.
- **`e2e-blocking`** — a deliberately small Playwright suite (the
  critical-path cases from each feature spec in [`specs/`](../specs/), plus an
  RBAC matrix) running against the preview environment, with traces/video on
  failure. Blocking: red means no merge. Everything beyond the critical paths
  runs as a separate **advisory** E2E tier that never blocks.
