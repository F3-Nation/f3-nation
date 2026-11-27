# GCP Cloud Run — New App Setup

Run these steps once when wiring a new (or migrated) app into the GCP Cloud Run + GitHub Actions CI/CD pipeline. Every app follows the same pattern: Artifact Registry → runtime service account and Cloud Run placeholder → Workload Identity Federation (WIF) service accounts → GitHub environments → secrets → domain mapping.

The Workload Identity pool (`github-actions`) and provider (`github`) live in the shared **`f3-github`** GCP project and are reused by every app. You **do not** re-create them — only create new service accounts and bind them.

---

## 1. Set Your Variables

Fill these in and paste the whole block into your terminal. Every subsequent command references them — no find-and-replace needed.

```bash
# ── App identity ─────────────────────────────────────────────────────────────
APP_NAME="me"                            # short identifier: me | map | api | auth | admin
CLOUDRUN_SERVICE="f3-me"                 # Cloud Run service name (usually f3-$APP_NAME)
GCP_REGION="us-central1"                 # GCP region for Cloud Run and Artifact Registry

# ── GCP projects ─────────────────────────────────────────────────────────────
GCP_STAGING_PROJECT="f3-me-app-staging"  # staging GCP project ID
GCP_PROD_PROJECT="f3-me-app"             # production GCP project ID

# ── Custom domains ───────────────────────────────────────────────────────────
STAGING_DOMAIN="staging.me.f3nation.com"
PROD_DOMAIN="me.f3nation.com"

# ── GitHub environments ───────────────────────────────────────────────────────
GH_STAGING_ENV="${APP_NAME}-staging"     # e.g. me-staging
GH_PROD_ENV="${APP_NAME}-production"     # e.g. me-production

# ── Derived — do not edit ────────────────────────────────────────────────────
WIF_PROJECT="f3-github"
STAGING_SA="github-actions-deploy@${GCP_STAGING_PROJECT}.iam.gserviceaccount.com"
PROD_SA="github-actions-deploy@${GCP_PROD_PROJECT}.iam.gserviceaccount.com"
STAGING_RUNTIME_SA="cloudrun-${CLOUDRUN_SERVICE}@${GCP_STAGING_PROJECT}.iam.gserviceaccount.com"
PROD_RUNTIME_SA="cloudrun-${CLOUDRUN_SERVICE}@${GCP_PROD_PROJECT}.iam.gserviceaccount.com"
```

After pasting, run this to confirm the values look right before continuing:

```bash
echo "App:     $APP_NAME"
echo "Service: $CLOUDRUN_SERVICE  Region: $GCP_REGION"
echo "Staging: $GCP_STAGING_PROJECT  →  $STAGING_DOMAIN"
echo "Prod:    $GCP_PROD_PROJECT  →  $PROD_DOMAIN"
echo "GH envs: $GH_STAGING_ENV / $GH_PROD_ENV"
```

---

## 2. Enable Required APIs

Enable the APIs used by the deployment pipeline in both app projects before creating resources or running deploy workflows.

```bash
gcloud services enable \
  serviceusage.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  --project="$GCP_STAGING_PROJECT"

gcloud services enable \
  serviceusage.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  --project="$GCP_PROD_PROJECT"
```

`sqladmin.googleapis.com` is required for apps that attach Cloud SQL instances with `--add-cloudsql-instances`. It is harmless for apps that do not use Cloud SQL.

---

## 3. Create Artifact Registry Repositories

Each GCP project gets its own Docker registry. The build job pushes to staging; the deploy-prod job copies the image to prod's registry (no rebuild).

```bash
gcloud artifacts repositories create cloud-run-builds \
  --repository-format=docker \
  --location="$GCP_REGION" \
  --project="$GCP_STAGING_PROJECT"

gcloud artifacts repositories create cloud-run-builds \
  --repository-format=docker \
  --location="$GCP_REGION" \
  --project="$GCP_PROD_PROJECT"
```

---

## 4. Create Runtime Service Accounts and Cloud Run Services

An app set up with this guide runs as its own runtime service account, `cloudrun-<service name>`, created with no roles. Every GCP resource the app uses at runtime (secrets, buckets, Cloud SQL) is granted to that account, so it holds exactly what the app needs. The alternative, the project's default Compute Engine service account, holds project Editor.

Apps reach GCP as this identity, never with a stored service-account key. A key is a long-lived secret that keeps working until someone deletes it; an identity's access ends when its grant is removed.

```bash
gcloud iam service-accounts create "cloudrun-${CLOUDRUN_SERVICE}" \
  --display-name="Cloud Run runtime: ${CLOUDRUN_SERVICE}" \
  --project="$GCP_STAGING_PROJECT"

gcloud iam service-accounts create "cloudrun-${CLOUDRUN_SERVICE}" \
  --display-name="Cloud Run runtime: ${CLOUDRUN_SERVICE}" \
  --project="$GCP_PROD_PROJECT"
```

Cloud Run requires an initial image before secrets/env can be configured. Deploy a placeholder that already runs as the runtime service account.

```bash
# Staging
gcloud run deploy "$CLOUDRUN_SERVICE" \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --service-account="$STAGING_RUNTIME_SA" \
  --region="$GCP_REGION" \
  --project="$GCP_STAGING_PROJECT" \
  --allow-unauthenticated

# Production
gcloud run deploy "$CLOUDRUN_SERVICE" \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --service-account="$PROD_RUNTIME_SA" \
  --region="$GCP_REGION" \
  --project="$GCP_PROD_PROJECT" \
  --allow-unauthenticated
```

A deploy that omits `--service-account` keeps the service's current account, so a service recreated by hand would come back as the default one. The app's deploy workflow pins the account per environment in `staging_flags` and `prod_flags` (`--service-account=<runtime SA email>`), which keeps the identity in code review and fails the deploy if the account is missing. The deploy service account may deploy as it through the project-level `roles/iam.serviceAccountUser` granted below.

### Move an existing service to its own runtime account

A service that already runs, usually as the default Compute Engine account, keeps its image: don't deploy the placeholder over it. Give the new account everything the service reads before switching, because a revision that can't read a referenced secret fails to start. Run this per environment; the example is staging.

```bash
PROJECT="$GCP_STAGING_PROJECT"
RUNTIME_SA="$STAGING_RUNTIME_SA"

gcloud iam service-accounts create "cloudrun-${CLOUDRUN_SERVICE}" \
  --display-name="Cloud Run runtime: ${CLOUDRUN_SERVICE}" \
  --project="$PROJECT"
# A new account can take a few seconds to be visible to IAM.
until gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT" >/dev/null 2>&1; do sleep 5; done

# Every secret the service references now, read from the live service. A
# failed lookup, parse or grant prints STOP instead of "All secrets granted."
if svc_json="$(gcloud run services describe "$CLOUDRUN_SERVICE" --region="$GCP_REGION" --project="$PROJECT" --format=json)" &&
  secrets="$(jq -r '[.spec.template.spec.containers[].env[]? | .valueFrom.secretKeyRef.name // empty] | unique[]' <<<"$svc_json")"; then
  failed=0
  for secret in $secrets; do
    gcloud secrets add-iam-policy-binding "$secret" \
      --project="$PROJECT" \
      --member="serviceAccount:${RUNTIME_SA}" \
      --role=roles/secretmanager.secretAccessor || failed=1
  done
  if [ "$failed" = 0 ]; then echo "All secrets granted."; else echo "STOP: a grant failed. Fix it before switching the account."; fi
else
  echo "STOP: couldn't read $CLOUDRUN_SERVICE or list its secrets (is jq installed?). Fix that before switching the account."
fi
```

Continue only after "All secrets granted." Then grant the account the rest of what the app uses from § 6 (Cloud SQL, buckets) and switch the running service to it. The update creates a new revision of the image already running; if it fails to start, the previous revision keeps serving.

```bash
gcloud run services update "$CLOUDRUN_SERVICE" \
  --service-account="$RUNTIME_SA" \
  --region="$GCP_REGION" --project="$PROJECT"
```

Switch each environment before the first deploy that pins the account there (`--service-account` in the workflow's `staging_flags` / `prod_flags`); a pinned deploy fails if the account is missing.

---

## 5. Set Up Workload Identity Federation (WIF)

The WIF pool and provider in `f3-github` are shared — **skip the creation commands if `f3-github` already exists** (it does for all apps after the first). Only run the SA + IAM + binding steps.

Each deploy service account trusts exactly one GitHub environment. GitHub puts the environment a job runs in into the token's subject (`repo:F3-Nation/f3-nation:environment:<name>`), the provider maps that to `google.subject`, and the [staging](#5c-staging-service-account) and [production](#5d-production-service-account) bindings name that subject. A job in another environment, or in none, cannot impersonate the account. This is also what makes the production environment's required reviewers count on the GCP side: GitHub issues a token with the production subject only after the deployment is approved.

Three things must stay in step with a binding:

- The environment name in the binding matches the `staging_environment` / `prod_environment` the app's deploy workflow passes, exactly.
- A service account that more than one environment deploys as needs one binding per environment.
- The repository keeps GitHub's default OIDC subject format. Customizing the subject claim changes the subject, and every binding has to change with it.

When a binding doesn't match, the deploy fails with a permission error on `iam.serviceAccounts.getAccessToken` the first time it calls GCP.

### 5a. Shared infrastructure (one-time, already done for existing apps)

```bash
# Skip if f3-github already exists
gcloud projects create "$WIF_PROJECT" --name="F3 GitHub CI/CD"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com \
  --project="$WIF_PROJECT"

gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --display-name="GitHub Actions" \
  --project="$WIF_PROJECT"

gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="attribute.repository==\"F3-Nation/f3-nation\"" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project="$WIF_PROJECT"
```

### 5b. Get the WIF project number (needed for every app)

```bash
WIF_PROJECT_NUMBER=$(gcloud projects describe "$WIF_PROJECT" --format='value(projectNumber)')
echo "WIF_PROJECT_NUMBER=$WIF_PROJECT_NUMBER"
```

### 5c. Staging service account

```bash
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project="$GCP_STAGING_PROJECT"

# Cloud Run admin + Artifact Registry writer + SA user + Service Usage viewer
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/serviceusage.serviceUsageViewer"

# Allow only jobs in the staging GitHub environment to impersonate the staging SA
gcloud iam service-accounts add-iam-policy-binding "$STAGING_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/subject/repo:F3-Nation/f3-nation:environment:${GH_STAGING_ENV}" \
  --project="$GCP_STAGING_PROJECT"
```

### 5d. Production service account

```bash
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project="$GCP_PROD_PROJECT"

# Cloud Run admin + SA user + Service Usage viewer on prod
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/serviceusage.serviceUsageViewer"

# Prod SA needs AR read on staging (pull the built image) and AR write on prod (push the promoted copy)
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/artifactregistry.reader"
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/artifactregistry.writer"

# Allow only jobs in the production GitHub environment to impersonate the prod SA
gcloud iam service-accounts add-iam-policy-binding "$PROD_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/subject/repo:F3-Nation/f3-nation:environment:${GH_PROD_ENV}" \
  --project="$GCP_PROD_PROJECT"
```

---

## 6. Grant Optional Resource Access

Some apps need access to additional GCP resources at deploy time or runtime. Apply only the sections that match the app.

### 6a. Cloud SQL access

Apps that deploy with `--add-cloudsql-instances` need Cloud SQL IAM in two places:

1. The GitHub Actions deploy service account needs to validate Cloud SQL and Service Usage state during `gcloud run deploy`.
2. The Cloud Run runtime service account needs to connect to the database after the revision starts.

Grant the deploy service accounts Cloud SQL Client on the app projects. If the app connects to Cloud SQL instances in another project, grant the same role on that database project too.

```bash
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/cloudsql.client"
```

If the Cloud SQL instance lives in a shared database project, also grant the deploy service accounts both Cloud SQL Client and Service Usage Viewer on that project:

```bash
DB_PROJECT="f3data" # change when using a different shared database project

gcloud projects add-iam-policy-binding "$DB_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/cloudsql.client"
gcloud projects add-iam-policy-binding "$DB_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/serviceusage.serviceUsageViewer"

gcloud projects add-iam-policy-binding "$DB_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/cloudsql.client"
gcloud projects add-iam-policy-binding "$DB_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/serviceusage.serviceUsageViewer"
```

Then grant the Cloud Run runtime service accounts Cloud SQL Client. A service set up before runtime service accounts may still run as another account; check with `gcloud run services describe "$CLOUDRUN_SERVICE" --region="$GCP_REGION" --project=<project> --format='value(spec.template.spec.serviceAccountName)'` and set `STAGING_RUNTIME_SA` / `PROD_RUNTIME_SA` to that account first:

```bash
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_RUNTIME_SA}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_RUNTIME_SA}" \
  --role="roles/cloudsql.client"

```

If the Cloud SQL instances are in a shared database project, also grant the runtime service accounts Cloud SQL Client on that project:

```bash
DB_PROJECT="f3data" # change when using a different shared database project

gcloud projects add-iam-policy-binding "$DB_PROJECT" \
  --member="serviceAccount:${STAGING_RUNTIME_SA}" \
  --role="roles/cloudsql.client"
gcloud projects add-iam-policy-binding "$DB_PROJECT" \
  --member="serviceAccount:${PROD_RUNTIME_SA}" \
  --role="roles/cloudsql.client"
```

### 6b. Storage bucket access

Apps that read from or write to Cloud Storage buckets at runtime, including apps that mount buckets as Cloud Run volumes, need bucket IAM for the Cloud Run runtime service account. `roles/storage.objectUser` includes object listing plus read/write access.

```bash
STAGING_BUCKETS=(
  "example-staging-bucket"
)

PROD_BUCKETS=(
  "example-prod-bucket"
)

for bucket in "${STAGING_BUCKETS[@]}"; do
  gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
    --member="serviceAccount:${STAGING_RUNTIME_SA}" \
    --role="roles/storage.objectUser"
done

for bucket in "${PROD_BUCKETS[@]}"; do
  gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
    --member="serviceAccount:${PROD_RUNTIME_SA}" \
    --role="roles/storage.objectUser"
done
```

For Cloud Run volume mounts, the `bucket=` value must be a bucket name only, not a folder path. Use `bucket=my-bucket`, not `bucket=my-bucket/some-prefix`.

#### Public image uploads

Apps that write public images through `@acme/storage` (org logos, user avatars) use the `f3-public-images-staging` and `f3-public-images` buckets in the shared `f3data` project. Each runtime service account gets `roles/storage.objectUser` on its own environment's bucket only, limited by an IAM condition to the one folder the app writes, so a compromised app can write only inside that folder, not the rest of the bucket. It can still overwrite images that any other service with access to the same folder wrote there. The folder is the path prefix the app's uploads use in [`packages/storage/src/public-images.ts`](../packages/storage/src/public-images.ts): `org-logos` for logo uploads, `user-avatars` for avatar uploads.

```bash
IMAGE_FOLDER="user-avatars" # the folder this app writes

gcloud storage buckets add-iam-policy-binding gs://f3-public-images-staging \
  --member="serviceAccount:${STAGING_RUNTIME_SA}" \
  --role="roles/storage.objectUser" \
  --condition="expression=resource.name.startsWith('projects/_/buckets/f3-public-images-staging/objects/${IMAGE_FOLDER}/'),title=${CLOUDRUN_SERVICE}-${IMAGE_FOLDER}"

gcloud storage buckets add-iam-policy-binding gs://f3-public-images \
  --member="serviceAccount:${PROD_RUNTIME_SA}" \
  --role="roles/storage.objectUser" \
  --condition="expression=resource.name.startsWith('projects/_/buckets/f3-public-images/objects/${IMAGE_FOLDER}/'),title=${CLOUDRUN_SERVICE}-${IMAGE_FOLDER}"
```

Bucket-level permission checks (`gcloud storage buckets get-iam-policy`, `testIamPermissions`) can't evaluate a per-object condition, so verify the grant with a real upload from the app. A missing grant makes the app's upload route answer 503 and log a `*.storage_access_denied` event.

---

## 7. Create GitHub Environments and Set Variables

The staging environment has no reviewer, so it deploys only from `main` and the app's release tags: that is what keeps a workflow on another branch from deploying as the staging service account. The prod environment requires a reviewer so deploys need manual approval. Run all of this from inside the repo directory:

```bash
GH_REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')

# Staging — deploys only from main and the app's release tags
gh api "repos/${GH_REPO}/environments/${GH_STAGING_ENV}" \
  --method PUT \
  --input - <<EOF
{
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
EOF
gh api "repos/${GH_REPO}/environments/${GH_STAGING_ENV}/deployment-branch-policies" \
  --method POST -f name=main -f type=branch
gh api "repos/${GH_REPO}/environments/${GH_STAGING_ENV}/deployment-branch-policies" \
  --method POST -f name="${APP_NAME}@*" -f type=tag

# Production — require the current GitHub user as a reviewer before each deploy
REVIEWER_ID=$(gh api user -q '.id')
gh api "repos/${GH_REPO}/environments/${GH_PROD_ENV}" \
  --method PUT \
  --input - <<EOF
{
  "reviewers": [{ "type": "User", "id": ${REVIEWER_ID} }]
}
EOF
```

The staging tag policy must match the tag pattern that triggers the app's deploy workflow, and a second release line that deploys through the same environment needs a tag policy of its own. `main` is allowed because the deploy workflow's manual re-deploy runs from the branch it is dispatched on.

> To add a team or additional reviewers, repeat the `gh api` call for prod with extra objects in the `reviewers` array (`"type": "Team"`, `"id": <team_id>`).

Now set the environment variable. Each environment gets its own `WIF_SA`, the service account that environment deploys as. `WIF_PROVIDER` is an organization-level variable, because every app shares one WIF provider, so it is not set per environment. These are `vars.*` (not secrets) — no credentials are stored in GitHub; auth happens via WIF token exchange at runtime.

If the organization doesn't have a `WIF_PROVIDER` variable yet (for example, because the pool was just created as part of the shared infrastructure setup), an organization admin sets it to `projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/providers/github`.

```bash
gh variable set WIF_SA       --env "$GH_STAGING_ENV" --repo "$GH_REPO" --body "$STAGING_SA"
gh variable set WIF_SA       --env "$GH_PROD_ENV" --repo "$GH_REPO" --body "$PROD_SA"
```

---

## 8. Push App Secrets to Cloud Run

See the app's own setup instructions for the environment variables and secrets its Cloud Run service needs, and how to set them.

---

## 9. Map Custom Domains

```bash
gcloud beta run domain-mappings create \
  --service="$CLOUDRUN_SERVICE" \
  --domain="$STAGING_DOMAIN" \
  --region="$GCP_REGION" \
  --project="$GCP_STAGING_PROJECT"

gcloud beta run domain-mappings create \
  --service="$CLOUDRUN_SERVICE" \
  --domain="$PROD_DOMAIN" \
  --region="$GCP_REGION" \
  --project="$GCP_PROD_PROJECT"
```

Follow the DNS instructions printed by each command. Propagation can take up to 24 hours but is usually minutes.

---

## 10. Disconnect Firebase App Hosting (if applicable)

If the app previously ran on Firebase App Hosting, remove it to stop duplicate auto-deploys:

In the Firebase Console for each project → **App Hosting** → select the backend named after your service → **Settings** → **Delete backend**.

---

## Checklist

- [ ] Variables set and confirmed (`echo` block)
- [ ] Required APIs enabled in staging and prod projects
- [ ] Artifact Registry repos created (staging + prod)
- [ ] Runtime SAs (`cloudrun-<service>`) created and the Cloud Run services created with a placeholder image, running as them
- [ ] Deploy workflow pins each environment's runtime SA with `--service-account` in `staging_flags` / `prod_flags`
- [ ] `f3-github` WIF pool/provider exists (skip creation if already present) and the organization-level `WIF_PROVIDER` variable points at it
- [ ] Staging SA created, IAM roles granted, WIF binding to the staging environment added
- [ ] Prod SA created, IAM roles granted (including cross-project AR read on staging), WIF binding to the production environment added
- [ ] Cloud SQL IAM granted to deploy/runtime SAs if the app uses Cloud SQL
- [ ] Storage bucket IAM granted to runtime SAs if the app uses Cloud Storage buckets or volume mounts (folder-scoped for public image uploads)
- [ ] GitHub environment setup complete: staging limited to `main` and release tags, prod reviewer set, `WIF_SA` set on each environment
- [ ] Cloud Run env vars pushed for staging and prod
- [ ] Custom domains mapped and DNS updated
- [ ] Firebase App Hosting disconnected (if applicable)
- [ ] OAuth clients registered with auth provider (if the app uses F3 SSO — see app README)

---

## Slackbot Notes

Even though Slackbot is a Python app, it follows the same setup flow as the other apps for deploying the Cloud Run Service.

In addition to the Cloud Run Service, Slackbot has a Cloud Run Job that is used to execute scripts. This is deployed through a separate GitHub Action.

Use the same WIF, environment, secret, and domain-mapping flow above. The main service and scripts job each deploy from the same tag stream via GitHub Actions.
