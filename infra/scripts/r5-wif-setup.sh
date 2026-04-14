#!/usr/bin/env bash
#
# r5-wif-setup.sh
#
# One-time setup for GitHub Actions -> GCP Workload Identity Federation
# for the R5 multi-tenant redirect platform image builds.
#
# Creates (idempotently):
#   1. Workload Identity Pool           : f3r5-gh-pool
#   2. OIDC Provider (GitHub Actions)   : f3r5-gh-provider
#   3. CI service account               : f3r5-ci-builder@f3-redirects.iam.gserviceaccount.com
#   4. Artifact Registry IAM binding    : roles/artifactregistry.writer on f3-redirect-platform
#   5. WIF impersonation binding        : F3-Nation/f3-nation -> f3r5-ci-builder
#
# Run as a user with:
#   - roles/iam.workloadIdentityPoolAdmin on the project
#   - roles/iam.serviceAccountAdmin on the project
#   - roles/artifactregistry.admin on the f3-redirect-platform repo
#
# Reference:
#   https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
#
# After running, the script prints the two values that must be saved as
# GitHub repo secrets:
#   - GCP_WIF_PROVIDER
#   - GCP_CI_SERVICE_ACCOUNT

set -euo pipefail

# --- Configuration ----------------------------------------------------------

PROJECT_ID="${PROJECT_ID:-f3-redirects}"
PROJECT_NUMBER="${PROJECT_NUMBER:-355149658273}"
REGION="${REGION:-us-central1}"

POOL_ID="${POOL_ID:-f3r5-gh-pool}"
POOL_DISPLAY_NAME="F3 R5 GitHub Actions Pool"
PROVIDER_ID="${PROVIDER_ID:-f3r5-gh-provider}"
PROVIDER_DISPLAY_NAME="F3 R5 GitHub Actions Provider"

SA_NAME="${SA_NAME:-f3r5-ci-builder}"
SA_DISPLAY_NAME="F3 R5 CI Image Builder"
SA_DESCRIPTION="Pushes R5 runtime/reconciler/redirect-admin images to Artifact Registry"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

AR_REPO="${AR_REPO:-f3-redirect-platform}"

GITHUB_REPO="${GITHUB_REPO:-F3-Nation/f3-nation}"
GITHUB_ISSUER_URI="https://token.actions.githubusercontent.com"

# --- Helpers ----------------------------------------------------------------

log()  { printf "[r5-wif-setup] %s\n" "$*"; }
warn() { printf "[r5-wif-setup] WARN: %s\n" "$*" >&2; }
die()  { printf "[r5-wif-setup] ERROR: %s\n" "$*" >&2; exit 1; }

ensure_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: ${cmd}"
}

ensure_command gcloud

# --- Preflight --------------------------------------------------------------

log "Project : ${PROJECT_ID} (#${PROJECT_NUMBER})"
log "Pool    : ${POOL_ID}"
log "Provider: ${PROVIDER_ID}"
log "SA      : ${SA_EMAIL}"
log "AR repo : ${AR_REPO} in ${REGION}"
log "GH repo : ${GITHUB_REPO}"

gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 1. Workload Identity Pool ---------------------------------------------

if gcloud iam workload-identity-pools describe "${POOL_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    >/dev/null 2>&1; then
  log "Pool ${POOL_ID} already exists — skipping create"
else
  log "Creating workload identity pool ${POOL_ID}"
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --display-name="${POOL_DISPLAY_NAME}"
fi

POOL_FULL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

# --- 2. OIDC Provider -------------------------------------------------------

if gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --workload-identity-pool="${POOL_ID}" \
    >/dev/null 2>&1; then
  log "Provider ${PROVIDER_ID} already exists — skipping create"
else
  log "Creating OIDC provider ${PROVIDER_ID}"
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="${PROVIDER_DISPLAY_NAME}" \
    --issuer-uri="${GITHUB_ISSUER_URI}" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
fi

PROVIDER_FULL_NAME="${POOL_FULL_NAME}/providers/${PROVIDER_ID}"

# --- 3. CI Service Account --------------------------------------------------

if gcloud iam service-accounts describe "${SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    >/dev/null 2>&1; then
  log "Service account ${SA_EMAIL} already exists — skipping create"
else
  log "Creating service account ${SA_EMAIL}"
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="${SA_DISPLAY_NAME}" \
    --description="${SA_DESCRIPTION}"
fi

# --- 4. Artifact Registry writer on the f3-redirect-platform repo ----------

log "Granting roles/artifactregistry.writer on ${AR_REPO}"
gcloud artifacts repositories add-iam-policy-binding "${AR_REPO}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  >/dev/null

# --- 5. WIF impersonation binding ------------------------------------------

PRINCIPAL_SET="principalSet://iam.googleapis.com/${POOL_FULL_NAME}/attribute.repository/${GITHUB_REPO}"

log "Binding ${PRINCIPAL_SET} -> roles/iam.workloadIdentityUser"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${PRINCIPAL_SET}" \
  --condition=None \
  >/dev/null

# The google-github-actions/auth@v2 action uses
# iam.serviceAccounts.getAccessToken to mint short-lived access tokens.
# roles/iam.workloadIdentityUser on the service account grants exactly
# that permission for the federated principal; no additional SA-level
# binding is needed.

# --- Output -----------------------------------------------------------------

cat <<EOF

================================================================
R5 Workload Identity Federation setup complete.

Save these values as GitHub repo secrets on ${GITHUB_REPO}:

  GCP_WIF_PROVIDER        = ${PROVIDER_FULL_NAME}
  GCP_CI_SERVICE_ACCOUNT  = ${SA_EMAIL}

Via gh CLI:

  gh secret set GCP_WIF_PROVIDER --repo ${GITHUB_REPO} --body "${PROVIDER_FULL_NAME}"
  gh secret set GCP_CI_SERVICE_ACCOUNT --repo ${GITHUB_REPO} --body "${SA_EMAIL}"

================================================================
EOF
