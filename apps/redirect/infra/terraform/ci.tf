# CI identity for Terraform plan / drift detection (see
# .github/workflows/redirect-terraform-drift.yml). Keyless: GitHub Actions
# federates into this project's Workload Identity pool and impersonates a
# read-only service account — no long-lived key.
#
# The github-pool / github provider already existed (created out-of-band for
# the standalone F3-Nation/f3-redirect repo's deploy workflows). They are
# imported and codified here, and the provider's attribute condition is widened
# additively so the monorepo (F3-Nation/f3-nation) can federate too — without
# breaking the original repo's deploys.

data "google_project" "this" {
  project_id = var.project
}

locals {
  # GitHub repositories permitted to federate into this pool.
  #   F3-Nation/f3-redirect = original standalone repo (existing deploys)
  #   F3-Nation/f3-nation   = this monorepo (drift CI + future deploys)
  wif_repositories = ["F3-Nation/f3-redirect", "F3-Nation/f3-nation"]

  # Monorepo-scoped principalSet that may impersonate the read-only CI SA.
  monorepo_principal = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.repository/F3-Nation/f3-nation"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Additive: original repo plus the monorepo. CEL list membership.
  attribute_condition = "assertion.repository in ${jsonencode(local.wif_repositories)}"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Read-only service account the monorepo's drift workflow impersonates.
resource "google_service_account" "ci" {
  account_id   = "github-actions-ci"
  display_name = "GitHub Actions — Terraform plan / drift detection"
}

resource "google_service_account_iam_member" "ci_wif" {
  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.monorepo_principal
}

# Project-wide read so `terraform plan` can refresh every managed resource.
resource "google_project_iam_member" "ci_viewer" {
  project = var.project
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# getIamPolicy across services so plan can refresh the *_iam_member resources
# (bucket objectAdmin, artifact-registry reader, SA bindings) without write access.
resource "google_project_iam_member" "ci_security_reviewer" {
  project = var.project
  role    = "roles/iam.securityReviewer"
  member  = "serviceAccount:${google_service_account.ci.email}"
}
