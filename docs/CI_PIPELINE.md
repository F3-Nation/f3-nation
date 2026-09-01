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
  ├─ pr-title.yml ······· Conventional-Commit PR title lint [required to merge]
  └─ ci.yml
       ├─ format-check ·· pnpm format (Prettier)             [required to merge]
       ├─ lint ·········· pnpm lint (ESLint)                 [required to merge]
       ├─ typecheck ····· pnpm typecheck (tsc)               [required to merge]
       ├─ build ········· pnpm build (Turbo)                 [required to merge]
       ├─ test-coverage · pnpm test (Vitest vs postgres:18)  [required to merge]
       ├─ security-audit  pnpm audit --prod --level=high    [required to merge]
       ├─ db-schema-sync · Drizzle migration drift check    [required to merge]
       ├─ docker-build ·· per-app image build (6 apps)      [advisory]
       ├─ recent-package-watch · npm publish-date report    [advisory, comment]
       │
       ├─ (reserved) preview-env ·· per-PR Cloud Run deploy, opt-in label
       └─ (reserved) e2e-blocking · Playwright critical paths vs preview env
  │
merge to main (ruleset "main": PR required, the eight checks above required,
  │            no force-push, no deletion)
  ├─ ci.yml ············· full-workspace required checks
  └─ docker-cache-refresh per-app GHCR cache repair/refresh
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
use the shared `.github/actions/setup` for pnpm and Node from `.nvmrc`. The five
Turbo-backed jobs enable that action's GitHub Actions-backed remote cache;
unrelated setup callers do not start the cache server. Third-party actions are
SHA-pinned. The advisory Docker path is event-specific: PRs validate images with
read-only access to the GHCR cache, while a separate `main`-only job refreshes
it with package-write permission.

The five Turbo-backed required checks (`format-check`, `lint`, `typecheck`,
`build`, and `test-coverage`) add `--affected` on pull requests, selecting
changed workspaces and their dependents. Their checkouts include the complete
Git history needed for the comparison. Setup pins Turbo's affected calculation
to the pull request's exact base and head SHAs, while the tasks themselves run
against GitHub's checked-out synthetic merge commit. Pushes to `main` omit the
flag and validate the full workspace from a shallow checkout. Setup also runs
the full workspace when the pull request's base/head SHAs are unavailable,
Turbo selects no runnable task for the specific gate, receives no task name,
or fails to calculate or parse the affected set — `scripts/select-turbo-scope.sh`
implements these fallbacks and `scripts/select-turbo-scope.test.sh` (run from
the `lint` job) covers each one, including that a missing SHA is caught before
Turbo ever runs rather than silently falling through to Turbo's own
default `main`-vs-`HEAD` comparison. Each gate therefore verifies that it
schedules at least one task before `--affected` is enabled. The non-Turbo
safeguards in the `lint` job (`lint:ws`, coverage-threshold validation, Python
task validation, Turbo scope-selection validation, and `lint:unused`) remain
repository-wide on every run.

The Turbo cache adapter runs on localhost within each job and stores task
artifacts in GitHub Actions cache. Relative cache paths make cache versions
portable across runners whose temporary checkout paths differ. Docker layers
for these CI jobs live separately in GHCR, so they do not consume the Actions
cache budget. The pnpm store remains a smaller co-tenant with Turbo artifacts
in that budget and is still subject to GitHub's normal least-recently-used
eviction. Cache adapter startup is non-blocking: if it fails, Turbo runs without
remote caching rather than failing a required check and emits a workflow
warning. `GITHUB_SHA` remains declared as a pass-through variable because the
shared `eslint-config-turbo` rule `turbo/no-undeclared-env-vars` validates the
CI-factory reference. The CI-factory review and triage commands run directly
outside `turbo run`, so they inherit the runner-provided value normally, while
excluding the SHA from Turbo's global hash inputs preserves cross-commit cache
hits for every Turbo task.

Remote caching is enabled only for the five required CI checks during this
rollout. Preview and deploy workflows continue to build without this adapter so
their behavior is unchanged. A matching successful `test` task may be replayed
instead of re-executed; that is standard Turbo cache behavior, so post-rollout
validation should confirm useful hit rates and continue treating flaky tests as
test defects rather than relying on reruns. It should also inspect Actions cache
usage and key composition, confirm Turbo artifacts do not repeatedly evict the
pnpm store, and watch for upload throttling or rapid least-recently-used churn.
Legacy Docker cache entries from before the GHCR migration should age out; they
can be deleted manually if they create capacity pressure during the transition.

Two pieces of Turbo configuration keep that selection honest, so CI needs no
blocklist of its own:

- `packages/db-python` carries a `package.json` and `apps/slackbot` depends on
  it, mirroring the `f3-data-models` edge already declared in
  `apps/slackbot/pyproject.toml`. Without it Turbo cannot see the Python
  workspace, and a change touching both Python and TypeScript would schedule
  the TypeScript gates while silently dropping ruff, mypy, pytest, and the
  Python formatter.
- `globalDependencies` in `turbo.json` lists the root files Turbo cannot
  attribute to any package (`.gitignore`, `.nvmrc`, `.prettierignore`,
  `.python-version`, `pyproject.toml`, `uv.lock`, and
  `scripts/python-task.sh`). It feeds affected selection as well as cache
  hashing, so changing any of them marks every workspace affected — `.nvmrc`
  is included because every affected job takes its Node version from it.

This deliberately changes the PR guarantee: a green PR proves the workspaces
selected by Turbo's declared dependency graph, not every workspace in the
repository. Undeclared cross-workspace coupling can therefore surface in the
full `main` run after merge; a red full run blocks deploys until corrected. The
zero-selection and detection-failure fallbacks above protect against an empty
or unavailable affected set, but they cannot infer dependencies missing from
the graph or detect a plausible nonempty selection that differs from the
checked-out merge tree.

| #   | Gate                   | What it runs                                                                                                                                               | What it catches                                                                                                                    | Merge-blocking (`main` ruleset) |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | `format-check`         | `pnpm format` (affected workspaces and dependents on PRs; full workspace on `main`)                                                                        | Prettier drift                                                                                                                     | ✅                              |
| 2   | `lint`                 | `pnpm lint` (affected workspaces and dependents plus repository-wide safeguards on PRs; full workspace on `main`)                                          | ESLint violations (incl. security rules)                                                                                           | ✅                              |
| 3   | `typecheck`            | `pnpm typecheck` (affected workspaces and dependents on PRs; full workspace on `main`)                                                                     | Type errors in changed workspaces and their consumers                                                                              | ✅                              |
| 4   | `build`                | `pnpm build` (affected workspaces and dependents on PRs; full workspace on `main`)                                                                         | Build breakage in changed workspaces and their consumers                                                                           | ✅                              |
| 5   | `test-coverage`        | `pnpm test` for affected workspaces and dependents on PRs or the full workspace on `main`, plus the full API characterization suite, against `postgres:18` | Unit/integration regressions and API parity drift                                                                                  | ✅                              |
| 6   | `security-audit`       | `pnpm audit --prod --audit-level=high`                                                                                                                     | Known high/critical vulns in prod deps                                                                                             | ✅                              |
| 7   | `db-schema-sync`       | Regenerates Drizzle migrations from the schema and diffs them against committed output                                                                     | Schema/migration drift                                                                                                             | ✅                              |
| 8   | `docker-build`         | Per-app `docker build` (admin, api, auth, map, me, slackbot; matrix, `linux/amd64`, no image push, per-app GHCR layer cache)                               | Breakage specific to the pruned Docker context (catalog mismatches, isolated-linker resolution) that the workspace build can't see | ❌ advisory                     |
| 9   | `docker-cache-refresh` | Per-app Docker validation plus GHCR layer-cache export (`main` pushes only)                                                                                | Refreshes the read-only cache consumed by PR builds                                                                                | ❌ advisory                     |
| 10  | `recent-package-watch` | npm publish-time report for all workspace deps (same-repo PRs only)                                                                                        | Supply-chain freshness signal — flags deps published in the last 3 days; upserts a PR comment                                      | ❌ advisory                     |
| —   | `pr-title.yml`         | PR title lint (`lint-title`)                                                                                                                               | Non-Conventional-Commit squash titles                                                                                              | ✅ (separate workflow)          |

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
  uncached until the first merged `main` build creates the cache packages. Fork
  PRs without read access to the base repository's private GHCR packages remain
  uncached permanently and use the same safe fallback.
- The workflow concurrency group serializes pushes to `main`, so
  `docker-cache-refresh` writers cannot overlap on the mutable per-app tags.
  If importing or exporting an existing cache fails, the workflow attempts a
  clean repair. A failed repair emits a warning and performs one final uncached
  image validation, keeping the cache optional without hiding the outage or
  allowing a real image-build failure to pass.
- GHCR retains package versions outside this workflow. Repository maintainers
  should configure and periodically review a package retention policy; this
  workflow does not delete registry data because retention duration and
  recovery requirements are human-owned operational decisions.
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
