# CI identity for Terraform plan / drift detection (see .github/workflows/
# region-pages-terraform-drift.yml). Keyless: GitHub Actions authenticates via
# the F3-Nation org Workload Identity pool (same pattern as the deploy-*
# workflows) and impersonates this service account — no long-lived key.
#
# The pool lives in the shared identity project (number 1075411251042); the
# principalSet below scopes impersonation to workflows running in the
# F3-Nation/f3-nation repository.

locals {
  # F3-Nation shared GitHub Actions Workload Identity pool, restricted to this repo.
  github_wif_principal = "principalSet://iam.googleapis.com/projects/1075411251042/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation"
}

resource "google_service_account" "ci" {
  project      = var.project_id
  account_id   = "github-actions-deploy"
  display_name = "GitHub Actions — Terraform plan / drift detection"
}

# Let the F3-Nation/f3-nation repo's workflows impersonate this SA via WIF.
resource "google_service_account_iam_member" "ci_wif" {
  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_wif_principal
}

# Read-only project access so `terraform plan` can refresh every resource.
resource "google_project_iam_member" "ci_viewer" {
  project = var.project_id
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# Read secret values to assemble the plan's secret_values var (drift on a
# rotated secret is then surfaced as a pending version replacement).
resource "google_project_iam_member" "ci_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# State backend access (plan reads state + takes a lock).
resource "google_storage_bucket_iam_member" "ci_state" {
  bucket = "region-pages-tfstate"
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ci.email}"
}
