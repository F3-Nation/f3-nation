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
       ├─ format-check ·· pnpm format (Prettier)            [required to merge]
       ├─ lint ·········· pnpm lint (ESLint)                [required to merge]
       ├─ typecheck ····· pnpm typecheck (tsc)              [required to merge]
       ├─ build ········· pnpm build (Turbo, full workspace)[required to merge]
       ├─ test-coverage · pnpm test (Vitest vs postgres:18) [required to merge]
       ├─ security-audit  pnpm audit --prod --level=high    [required to merge]
       ├─ docker-build ·· per-app image build (5 apps)      [advisory]
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

All CI jobs run on `pull_request` (any target branch) and on `push` to `main`.
Every job checks out with `persist-credentials: false` and uses the shared
`.github/actions/setup` (pnpm + Node from `.nvmrc` + Turbo remote cache).
Third-party actions are SHA-pinned.

| #   | Gate                   | What it runs                                                                                                           | What it catches                                                                                                                         | Merge-blocking (`main` ruleset) |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `format-check`         | `pnpm format`                                                                                                          | Prettier drift                                                                                                                          | ✅                             |
| 2   | `lint`                 | `pnpm lint`                                                                                                            | ESLint violations (incl. security rules)                                                                                                | ✅                             |
| 3   | `typecheck`            | `pnpm typecheck`                                                                                                       | Type errors across the workspace                                                                                                        | ✅                             |
| 4   | `build`                | `pnpm build`                                                                                                           | Full-workspace build breakage                                                                                                           | ✅                             |
| 5   | `test-coverage`        | `pnpm test` against a `postgres:18` service container (`f3_test` DB, mock env vars)                                    | Unit/integration regressions                                                                                                            | ✅                             |
| 6   | `security-audit`       | `pnpm audit --prod --audit-level=high`                                                                                 | Known high/critical vulns in prod deps                                                                                                  | ✅                             |
| 7   | `docker-build`         | Per-app `docker build` (admin, api, auth, map, me; matrix, `linux/amd64`, no push, GHA layer cache + cache-miss retry) | Breakage specific to the pruned Docker context (catalog mismatches, isolated-linker resolution) that the full-workspace build can't see | ❌ advisory                    |
| 8   | `recent-package-watch` | npm publish-time report for all workspace deps (same-repo PRs only)                                                    | Supply-chain freshness signal — flags deps published in the last 3 days; upserts a PR comment                                           | ❌ advisory                    |
| —   | `pr-title.yml`         | PR title lint                                                                                                          | Non-Conventional-Commit squash titles                                                                                                   | (separate workflow)            |

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

`recreate-staging.yml` exists to rebuild the staging environment.

## Observations (documented, not changed here)

- `docker-build` runs on every PR but is **not** in the `main` ruleset's
  required checks — an image-only breakage can merge and will surface at
  release time in the deploy `build` job.
- The deploy `ci-gate` regexp waits on the five build/test checks but not
  `security-audit` (the audit already gated the merge; a tag cut from an
  unmerged or old SHA relies on that earlier gate).
- The two reserved rungs below are the planned homes for end-to-end
  verification, which today has no rung at all (Playwright was removed from
  the repo; the `**/tests/**/*.spec.ts` glob remains reserved for it).

## Reserved rungs (planned, not yet implemented)

These are documented now so their position in the chain is agreed before any
workflow changes:

- **`preview-env`** — per-PR Cloud Run preview environment, opt-in via a
  `preview` label; scale-to-zero; own seeded database; torn down on PR
  close/merge plus a daily TTL reaper. Slots in as a PR job alongside the
  existing gates.
- **`e2e-blocking`** — a deliberately small Playwright suite (the
  critical-path cases from each feature spec in [`specs/`](../specs/), plus an
  RBAC matrix) running against the preview environment, with traces/video on
  failure. Blocking: red means no merge. Everything beyond the critical paths
  runs as a separate **advisory** E2E tier that never blocks.

Neither rung exists yet; nothing in this document changes current behavior.
