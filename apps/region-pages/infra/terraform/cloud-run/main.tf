provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "compute.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_registry_repository_id
  description   = "Container images for the F3 region-pages app."
  format        = "DOCKER"
  labels        = var.service_labels

  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "f3-region-pages-run"
  display_name = "F3 region-pages Cloud Run runtime"
}

# The app reaches the warehouse via the Cloud SQL connector at runtime
# (WAREHOUSE_DB_CONNECTION_MODE=connector), which authenticates as this SA.
resource "google_project_iam_member" "runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "app" {
  name                = var.service_name
  location            = var.region
  ingress             = var.ingress
  labels              = var.service_labels
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      # Plain (non-secret) runtime configuration.
      env {
        name  = "WAREHOUSE_DB_CONNECTION_MODE"
        value = "connector"
      }

      # Secret-backed runtime configuration.
      dynamic "env" {
        for_each = local.runtime_secrets
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.key].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.runtime,
    google_secret_manager_secret_iam_member.runtime_accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Custom-domain serving is handled by an external HTTPS load balancer in lb.tf
# (serverless NEG + Google-managed cert), not by a Cloud Run domain mapping.
# The load balancer avoids Webmaster/Search Console domain verification: the
# managed certificate validates automatically once DNS points at the LB IP, so
# the DNS hand-off is a single A record. See lb.tf and the `load_balancer_ip`
# output.
