# R5 Build & Push Images

Workflow: [`r5-build-push-images.yml`](./r5-build-push-images.yml)

Builds and pushes Docker images for the three R5 apps in the multi-tenant
redirect platform to Google Artifact Registry:

| App              | Package                | Dockerfile                       |
| ---------------- | ---------------------- | -------------------------------- |
| `runtime`        | `@acme/runtime`        | `apps/runtime/Dockerfile`        |
| `reconciler`     | `@acme/reconciler`     | `apps/reconciler/Dockerfile`     |
| `redirect-admin` | `@acme/redirect-admin` | `apps/redirect-admin/Dockerfile` |

All three Dockerfiles use `turbo prune --docker` against the repo root as
the build context — the workflow matches that by running `docker buildx
build` with `context: .` and `file: apps/<app>/Dockerfile`.

Images land at:

```
us-central1-docker.pkg.dev/f3-redirects/f3-redirect-platform/<app>:<git-sha>
us-central1-docker.pkg.dev/f3-redirects/f3-redirect-platform/<app>:latest
```

## Triggers

- **`push`** on `feat/r5-runtime`, `feat/r5-reconciler-ops-5-8`,
  `feat/r5-redirect-admin`, `feat/r5-admin-verification`, and `dev`, scoped
  to paths under `apps/runtime/**`, `apps/reconciler/**`,
  `apps/redirect-admin/**`, or `packages/redirect-platform-db/**`.
  `dorny/paths-filter` narrows the matrix to only the apps whose code or
  shared schema package actually changed.
- **`workflow_dispatch`** with three inputs:
  - `app` — `all` | `runtime` | `reconciler` | `redirect-admin`
  - `target_ref` — git ref to build (defaults to the ref the workflow was
    dispatched on; accepts branches, tags, or SHAs)
  - `push` — whether to push the built image (`true` by default)

> **Known limitation — push triggers.** The `push` triggers only fire on
> branches that already exist on `origin`. The R5 Dockerfiles currently
> live on feature branches (`feat/r5-runtime`,
> `feat/r5-reconciler-ops-5-8`, `feat/r5-redirect-admin`) — **not on
> `dev`**. Until those feature branches merge, the `push` trigger for
> `dev` will be a no-op. Use `workflow_dispatch` with `target_ref` set to
> the feature branch for ad-hoc builds in the meantime.

## Jobs

1. **`detect-changes`** — resolves the target ref, checks out the repo
   once at that ref, and computes the build matrix.
   - `workflow_dispatch`: matrix reflects the `app` input
     (`all` -> all three).
   - `push`: matrix is derived from `dorny/paths-filter@v3` comparing
     against `github.event.before`.
2. **`build-push`** — matrix job that runs once per selected app:
   - Checks out at `target_ref`.
   - Sets up Docker Buildx.
   - Authenticates to GCP via Workload Identity Federation
     (`google-github-actions/auth@v2` with `GCP_WIF_PROVIDER` +
     `GCP_CI_SERVICE_ACCOUNT`).
   - Runs `gcloud auth configure-docker us-central1-docker.pkg.dev`.
   - Builds and pushes via `docker/build-push-action@v6` with
     `platforms: linux/amd64`, SHA + `latest` tags, and a per-app GHA
     buildx cache scope.
   - Writes a step summary with the pushed tag.
3. **`notify-deploy-ready`** — aggregates matrix results and:
   - Writes a step summary listing every pushed image and the exact
     `terraform apply` invocation to deploy them.
   - If the triggering ref has an open PR, posts the same summary as a
     PR comment.

## Secrets

Two secrets are required on the `F3-Nation/f3-nation` repo. No long-lived
service-account keys — everything flows through Workload Identity
Federation.

| Secret                   | Example value                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GCP_WIF_PROVIDER`       | `projects/355149658273/locations/global/workloadIdentityPools/f3r5-gh-pool/providers/f3r5-gh-provider` |
| `GCP_CI_SERVICE_ACCOUNT` | `f3r5-ci-builder@f3-redirects.iam.gserviceaccount.com`                                                 |

Set them with `gh`:

```bash
gh secret set GCP_WIF_PROVIDER \
  --repo F3-Nation/f3-nation \
  --body 'projects/355149658273/locations/global/workloadIdentityPools/f3r5-gh-pool/providers/f3r5-gh-provider'

gh secret set GCP_CI_SERVICE_ACCOUNT \
  --repo F3-Nation/f3-nation \
  --body 'f3r5-ci-builder@f3-redirects.iam.gserviceaccount.com'
```

> Note: the existing `deploy-auth.yml` workflow authenticates with
> `vars.WIF_PROVIDER` / `vars.WIF_SA` for the **f3-authentication**
> project. That pool and service account are scoped to a different GCP
> project and AR repo — R5 needs its own dedicated pool, provider, and
> service account in the `f3-redirects` project, created by
> `infra/scripts/r5-wif-setup.sh`.

## One-time WIF setup

The project owner runs `infra/scripts/r5-wif-setup.sh` once against the
`f3-redirects` GCP project. The script is idempotent — rerunning it is
safe and will no-op against already-provisioned resources.

```bash
# Requires gcloud auth with:
#   - roles/iam.workloadIdentityPoolAdmin on f3-redirects
#   - roles/iam.serviceAccountAdmin on f3-redirects
#   - roles/artifactregistry.admin on the f3-redirect-platform AR repo

gcloud auth login
./infra/scripts/r5-wif-setup.sh
```

The script creates:

1. Workload Identity Pool `f3r5-gh-pool` in `f3-redirects`.
2. OIDC provider `f3r5-gh-provider` bound to
   `https://token.actions.githubusercontent.com`, with attribute mapping
   `google.subject=assertion.sub`, `attribute.repository=assertion.repository`,
   `attribute.ref=assertion.ref`, and an attribute condition pinning the
   pool to `F3-Nation/f3-nation`.
3. CI service account `f3r5-ci-builder@f3-redirects.iam.gserviceaccount.com`.
4. `roles/artifactregistry.writer` grant on the `f3-redirect-platform`
   Artifact Registry repo (scoped to the repo, **not** the project).
5. `roles/iam.workloadIdentityUser` binding allowing the
   `F3-Nation/f3-nation` repo principal set to impersonate the CI
   service account via `iam.serviceAccounts.getAccessToken`.

The script finishes by printing the exact values to save as
`GCP_WIF_PROVIDER` and `GCP_CI_SERVICE_ACCOUNT`.

Reference:
<https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines>

## Triggering a manual build

```bash
# Build all three apps from the current state of a feature branch
gh workflow run r5-build-push-images.yml \
  --repo F3-Nation/f3-nation \
  --ref feat/r5-ci-image-builds \
  -f app=all \
  -f target_ref=feat/r5-runtime

# Build just the reconciler against a specific SHA
gh workflow run r5-build-push-images.yml \
  --repo F3-Nation/f3-nation \
  --ref feat/r5-ci-image-builds \
  -f app=reconciler \
  -f target_ref=<sha>

# Dry run — build without pushing
gh workflow run r5-build-push-images.yml \
  --repo F3-Nation/f3-nation \
  --ref feat/r5-ci-image-builds \
  -f app=runtime \
  -f target_ref=feat/r5-runtime \
  -f push=false
```

`--ref feat/r5-ci-image-builds` is the branch the workflow file itself
lives on; `-f target_ref=...` is the branch whose source code is built.

## Known limitations

- **`push` triggers don't fire until Dockerfiles land on `dev`.** The
  R5 Dockerfiles only exist on the feature branches today. Once those
  feature branches merge into `dev` via the R5 integration PRs, the
  `push` trigger on `dev` will start firing automatically. Until then,
  use `workflow_dispatch` with `target_ref` for every build.
- **Single architecture.** Images are built for `linux/amd64` only.
  Cloud Run amd64 runners are the deploy target; arm64 is not currently
  needed. Add a second platform here if that changes.
- **No image scanning.** The workflow does not run Trivy/Grype or
  Artifact Registry vulnerability scanning beyond whatever is enabled
  at the AR repo level. Add a scan step before production rollout if
  the security posture demands it.
- **Cache is scoped to the GHA cache.** Buildx uses
  `type=gha,scope=r5-<app>` — fast on the same app/branch pair, cold
  across branches. No registry cache mirror is configured yet.

## Files

- [`.github/workflows/r5-build-push-images.yml`](./r5-build-push-images.yml)
- [`infra/scripts/r5-wif-setup.sh`](../../infra/scripts/r5-wif-setup.sh)
