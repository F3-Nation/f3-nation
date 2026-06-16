# GCP Cloud Run — New App Setup

Run these steps once when wiring a new (or migrated) app into the GCP Cloud Run + GitHub Actions CI/CD pipeline. Every app follows the same pattern: Artifact Registry → Cloud Run placeholder → Workload Identity Federation (WIF) service accounts → GitHub environments → secrets → domain mapping.

The Workload Identity pool (`github-actions`) and provider (`github`) live in the shared **`f3-github`** GCP project and are reused by every app. You **do not** re-create them — only create new service accounts and bind them.

---

## 1. Set Your Variables

Fill these in and paste the whole block into your terminal. Every subsequent command references them — no find-and-replace needed.

```bash
# ── App identity ─────────────────────────────────────────────────────────────
APP_NAME="me"                            # short identifier: me | map | api | auth | admin
CLOUDRUN_SERVICE="f3-me"                 # Cloud Run service name (usually f3-$APP_NAME)
GCP_REGION="us-east1"                   # GCP region for Cloud Run and Artifact Registry

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

## 2. Create Artifact Registry Repositories

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

## 3. Create Cloud Run Services

Cloud Run requires an initial image before secrets/env can be configured. Deploy a placeholder first.

```bash
# Staging
gcloud run deploy "$CLOUDRUN_SERVICE" \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region="$GCP_REGION" \
  --project="$GCP_STAGING_PROJECT" \
  --allow-unauthenticated

# Production
gcloud run deploy "$CLOUDRUN_SERVICE" \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region="$GCP_REGION" \
  --project="$GCP_PROD_PROJECT" \
  --allow-unauthenticated
```

---

## 4. Set Up Workload Identity Federation (WIF)

The WIF pool and provider in `f3-github` are shared — **skip the creation commands if `f3-github` already exists** (it does for all apps after the first). Only run the SA + IAM + binding steps.

### 4a. Shared infrastructure (one-time, already done for existing apps)

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

### 4b. Get the WIF project number (needed for every app)

```bash
WIF_PROJECT_NUMBER=$(gcloud projects describe "$WIF_PROJECT" --format='value(projectNumber)')
echo "WIF_PROJECT_NUMBER=$WIF_PROJECT_NUMBER"
```

### 4c. Staging service account

```bash
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project="$GCP_STAGING_PROJECT"

# Cloud Run admin + Artifact Registry writer + SA user
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${STAGING_SA}" \
  --role="roles/iam.serviceAccountUser"

# Allow GitHub Actions to impersonate the staging SA
gcloud iam service-accounts add-iam-policy-binding "$STAGING_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation" \
  --project="$GCP_STAGING_PROJECT"
```

### 4d. Production service account

```bash
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project="$GCP_PROD_PROJECT"

# Cloud Run admin + SA user on prod
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/iam.serviceAccountUser"

# Prod SA needs AR read on staging (pull the built image) and AR write on prod (push the promoted copy)
gcloud projects add-iam-policy-binding "$GCP_STAGING_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/artifactregistry.reader"
gcloud projects add-iam-policy-binding "$GCP_PROD_PROJECT" \
  --member="serviceAccount:${PROD_SA}" \
  --role="roles/artifactregistry.writer"

# Allow GitHub Actions to impersonate the prod SA
gcloud iam service-accounts add-iam-policy-binding "$PROD_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation" \
  --project="$GCP_PROD_PROJECT"
```

---

## 5. Create GitHub Environments and Set Variables

The staging environment needs no protection rules. The prod environment requires a reviewer so deploys need manual approval. Run all of this from inside the repo directory:

```bash
GH_REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')

# Staging — no protection rules
gh api "repos/${GH_REPO}/environments/${GH_STAGING_ENV}" --method PUT

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

> To add a team or additional reviewers, repeat the `gh api` call for prod with extra objects in the `reviewers` array (`"type": "Team"`, `"id": <team_id>`).

Now set the environment variables. These are `vars.*` (not secrets) — no credentials are stored in GitHub; auth happens via WIF token exchange at runtime.

```bash
WIF_PROVIDER_VALUE="projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/providers/github"

gh variable set WIF_PROVIDER --env "$GH_STAGING_ENV" --repo "$GH_REPO" --body "$WIF_PROVIDER_VALUE"
gh variable set WIF_SA       --env "$GH_STAGING_ENV" --repo "$GH_REPO" --body "$STAGING_SA"

gh variable set WIF_PROVIDER --env "$GH_PROD_ENV" --repo "$GH_REPO" --body "$WIF_PROVIDER_VALUE"
gh variable set WIF_SA       --env "$GH_PROD_ENV" --repo "$GH_REPO" --body "$PROD_SA"
```

---

## 6. Push App Secrets to Cloud Run

Each app has its own `.env.cloud-run.example` file and a helper script that pushes env vars to Cloud Run as secrets.

```bash
# Copy the example and populate with real values
cp "apps/${APP_NAME}/.env.cloud-run.example" "apps/${APP_NAME}/.env.cloud-run.staging"
cp "apps/${APP_NAME}/.env.cloud-run.example" "apps/${APP_NAME}/.env.cloud-run.prod"

# Edit each file with the correct environment-specific values
# Never commit these files

# Push to Cloud Run
bash "apps/${APP_NAME}/scripts/cloud-run-env.sh" --env staging
bash "apps/${APP_NAME}/scripts/cloud-run-env.sh" --env prod
```

---

## 7. Map Custom Domains

```bash
gcloud run domain-mappings create \
  --service="$CLOUDRUN_SERVICE" \
  --domain="$STAGING_DOMAIN" \
  --region="$GCP_REGION" \
  --project="$GCP_STAGING_PROJECT"

gcloud run domain-mappings create \
  --service="$CLOUDRUN_SERVICE" \
  --domain="$PROD_DOMAIN" \
  --region="$GCP_REGION" \
  --project="$GCP_PROD_PROJECT"
```

Follow the DNS instructions printed by each command. Propagation can take up to 24 hours but is usually minutes.

---

## 8. Disconnect Firebase App Hosting (if applicable)

If the app previously ran on Firebase App Hosting, remove it to stop duplicate auto-deploys:

In the Firebase Console for each project → **App Hosting** → select the backend named after your service → **Settings** → **Delete backend**.

---

## Checklist

- [ ] Variables set and confirmed (`echo` block)
- [ ] Artifact Registry repos created (staging + prod)
- [ ] Cloud Run services created with placeholder image
- [ ] `f3-github` WIF pool/provider exists (skip creation if already present)
- [ ] Staging SA created, IAM roles granted, WIF binding added
- [ ] Prod SA created, IAM roles granted (including cross-project AR read on staging), WIF binding added
- [ ] GitHub environments created and `WIF_PROVIDER`/`WIF_SA` variables set (step 5)
- [ ] Cloud Run env vars pushed for staging and prod
- [ ] Custom domains mapped and DNS updated
- [ ] Firebase App Hosting disconnected (if applicable)
- [ ] OAuth clients registered with auth provider (if the app uses F3 SSO — see app README)
