locals {
  apis = [
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    # Required by the Terraform google provider itself (project / IAM / SA /
    # service reads). Needed so the drift-detection CI — which quotas its API
    # calls against this project — can run `plan`.
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
  ]
  image = "${var.region}-docker.pkg.dev/${var.project}/${var.name}/redirectd:${var.image_tag}"
}

# --- Enable required APIs ---------------------------------------------------
resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# --- Shared bucket: flat-file config + on-demand TLS cert storage -----------
resource "google_storage_bucket" "data" {
  name                        = "${var.project}-${var.name}"
  location                    = var.region
  uniform_bucket_level_access = true
  # Hard-block any accidental public IAM grant (uniform access alone doesn't).
  public_access_prevention = "enforced"
  force_destroy            = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.apis]
}

# --- Artifact Registry (Docker images) --------------------------------------
resource "google_artifact_registry_repository" "repo" {
  repository_id = var.name
  location      = var.region
  format        = "DOCKER"
  description   = "Redirect tier container images"
  depends_on    = [google_project_service.apis]
}

# --- Service account for the VM ---------------------------------------------
resource "google_service_account" "redirect" {
  account_id   = "${var.name}-runtime"
  display_name = "Redirect tier runtime"
}

# Read/write the config + cert objects in the bucket.
resource "google_storage_bucket_iam_member" "object_admin" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.redirect.email}"
}

# Pull images from Artifact Registry.
resource "google_artifact_registry_repository_iam_member" "puller" {
  repository = google_artifact_registry_repository.repo.name
  location   = google_artifact_registry_repository.repo.location
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.redirect.email}"
}

# --- Reserved static IP (apex A-records point here) -------------------------
resource "google_compute_address" "redirect" {
  name         = "${var.name}-ip"
  region       = var.region
  address_type = "EXTERNAL"
  depends_on   = [google_project_service.apis]
}

# --- Firewall: allow inbound 80/443 -----------------------------------------
resource "google_compute_firewall" "web" {
  name      = "${var.name}-allow-web"
  network   = "default"
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${var.name}-web"]
  depends_on    = [google_project_service.apis]
}

# --- The redirect VM (Container-Optimized OS) -------------------------------
resource "google_compute_instance" "redirect" {
  name         = "${var.name}-vm"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["${var.name}-web"]

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 10
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.redirect.address
    }
  }

  metadata = {
    startup-script = templatefile("${path.module}/startup-script.sh.tftpl", {
      image           = local.image
      region          = var.region
      bucket          = google_storage_bucket.data.name
      config_object   = var.config_object
      cert_prefix     = var.cert_prefix
      acme_email      = var.acme_email
      acme_staging    = var.acme_staging ? "true" : "false"
      redirect_status = var.redirect_status
      admin_host      = var.admin_host
      admin_upstream  = var.admin_upstream
    })
    google-logging-enabled = "true"
    # Don't inherit project-wide SSH keys on this internet-facing VM; access is
    # via the GCP console/IAP only. Flip to OS Login if interactive SSH is ever
    # needed.
    block-project-ssh-keys = "true"
  }

  service_account {
    email  = google_service_account.redirect.email
    scopes = ["cloud-platform"]
  }

  allow_stopping_for_update = true

  depends_on = [
    google_storage_bucket_iam_member.object_admin,
    google_artifact_registry_repository_iam_member.puller,
  ]
}
