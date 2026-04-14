# `@acme/reconciler` — redirect platform reconciler Cloud Run job

> **Status:** scaffold only. F3R5_009.
> Reconciler operations 1-4 land in F3R5_010, operations 5-8 in F3R5_011.

This app is a **Cloud Run Job** (one-shot per invocation) that drives the F3
redirect platform lifecycle state machine. Cloud Scheduler invokes it every
5 minutes in both `us-central1` and `europe-west1`; a singleton lease in
Postgres (`reconciler_leases`) ensures only one region is doing work at a
time in the steady state.

See R5 Decision 6 (Backend Reconciler with Designed Concurrency) for the
authoritative spec, and the full plan at
`~/workspaces/clients/f3-nation/f3-redirect/docs/plans/2026-04-14-multi-tenant-saas-refactor.md`.

## Repo location (migrated 2026-04-14)

This app was **migrated from the f3-redirect repo into the f3-nation monorepo
on 2026-04-14** (task F3R5_015) per the R5 schema-sharing decision — Option A
in the plan's Decision 7 follow-up: move the reconciler into the same repo
as the canonical Drizzle schema (`@acme/redirect-platform-db`) and the
admin UI (`apps/redirect-admin`, placed in f3-nation per Decision 5).

Before the migration the reconciler carried a loud duplicated-schema stub at
`src/db/schema.ts` with a TODO about cross-repo schema sharing. That stub
has been **deleted**; `src/db/client.ts` now imports `schema` directly from
`@acme/redirect-platform-db`, and the workspace link makes drift impossible.

The original branch in f3-redirect (`feat/r5-reconciler-scaffold`) is now
orphaned reference material.

## What the scaffold implements (F3R5_009)

- [x] Config loading and validation (`src/config.ts`)
- [x] Structured JSON logging matching the F3R5_003 alert policy contract (`src/logging.ts`)
- [x] Neon Drizzle client (`src/db/client.ts`) — schema from `@acme/redirect-platform-db`
- [x] Singleton lease acquire / heartbeat / release (`src/lease.ts`)
- [x] `withHeartbeat(...)` runner with 30-minute hard cap (`src/lease.ts`)
- [x] `processTransientStates(...)` stub (`src/process.ts`)
- [x] Main entry point wiring everything together (`src/index.ts`)
- [x] Unit tests for lease SQL and logging (`tests/`)
- [x] `apps/reconciler/Dockerfile` (inside the app directory, following the
      `apps/auth/Dockerfile` / `apps/api/Dockerfile` pattern)

## What the scaffold does NOT implement

- Reconciler operations 1-4 (DNS challenge validation, cert provisioning,
  SNI probe, post-cutover DNS verification) — **F3R5_010** (now unblocked
  by this migration)
- Reconciler operations 5-8 (active health re-probe, tombstone cleanup,
  quarantine drift check, periodic drift detection) — F3R5_011
- Cloud Scheduler + Cloud Run Job Terraform wiring — F3R5_004

## Log label contract (interop with F3R5_003)

The structured logging module in `src/logging.ts` emits labels in the exact
shape expected by the alert policies in
`/tmp/f3-r5-infra/infra/terraform/shared-platform/alert_policies.tf` (the
Terraform module stays in the f3-redirect repo — only the reconciler app
moved to f3-nation). Filter expressions:

```
resource.type="cloud_run_job"
severity=CRITICAL
jsonPayload.labels.redirect_platform_drift="true"
```

```
resource.type="cloud_run_job"
severity=CRITICAL
jsonPayload.labels.redirect_platform_stuck_operation="true"
```

```
resource.type="cloud_run_job"
severity=CRITICAL
jsonPayload.labels.redirect_platform_cert_renewal="true"
```

Cloud Logging promotes top-level JSON fields on stdout into `jsonPayload`,
so emitting `labels.redirect_platform_*="true"` at the top level of a
stdout JSON entry matches the filter path `jsonPayload.labels.redirect_platform_*`.
**Do not rename these labels or change the string value `"true"` without
coordinating with F3R5_003.**

## Required environment variables

| Name                             | Purpose                                                                                                                                                                                                  | Required? |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `REDIRECT_PLATFORM_DATABASE_URL` | Neon connection string for the `redirect_reconciler` role (see R5 Decision 8)                                                                                                                            | yes       |
| `RECONCILER_REGION`              | GCP region of this task (`us-central1` \| `europe-west1`)                                                                                                                                                | yes       |
| `RECONCILER_INSTANCE_ID`         | Optional override for the lease `held_by`. When unset, we synthesize from `${RECONCILER_REGION}-${CLOUD_RUN_EXECUTION}-task${CLOUD_RUN_TASK_INDEX}-${rand}` or fall back to `local-${hostname}-${rand}`. | no        |

On Cloud Run Jobs, `CLOUD_RUN_EXECUTION` and `CLOUD_RUN_TASK_INDEX` are set
automatically by the runtime, so you only need to provide the database URL
and region.

## Local development

```bash
# From the repo root
pnpm install
pnpm --filter @acme/reconciler typecheck
pnpm --filter @acme/reconciler test
pnpm --filter @acme/reconciler lint
pnpm --filter @acme/reconciler build

# Run against a local Postgres (or a Neon dev branch) with the table
# created from R5 Decision 7:
export REDIRECT_PLATFORM_DATABASE_URL='postgresql://...'
export RECONCILER_REGION='us-central1'
pnpm --filter @acme/reconciler start
```

## Deployment

Deferred to **F3R5_004** (Cloud Scheduler + Cloud Run Job Terraform). The
image is built from `apps/reconciler/Dockerfile`.
