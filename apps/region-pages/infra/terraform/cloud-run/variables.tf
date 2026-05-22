variable "project_id" {
  description = "Google Cloud project ID that hosts the region-pages service."
  type        = string
  default     = "region-pages"
}

variable "region" {
  description = "Google Cloud region for Cloud Run and Artifact Registry."
  type        = string
  default     = "us-central1"
}

variable "artifact_registry_repository_id" {
  description = "Artifact Registry Docker repository that stores the region-pages image."
  type        = string
  default     = "f3-region-pages"
}

variable "service_name" {
  description = "Cloud Run service name for the region-pages app."
  type        = string
  default     = "f3-region-pages"
}

variable "image" {
  description = "Fully-qualified container image for the region-pages service, e.g. us-central1-docker.pkg.dev/region-pages/f3-region-pages/web:v1."
  type        = string
}

variable "service_domain" {
  description = "Optional domain mapped directly to the Cloud Run service (e.g. regions.f3nation.com). Left empty until the F3 Nation dev team (Tackle) is ready to make the DNS change; the domain mapping resource is disabled while empty."
  type        = string
  default     = ""
}

variable "ingress" {
  description = "Cloud Run ingress policy."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "allow_unauthenticated" {
  description = "Whether to make the service publicly accessible (allUsers can invoke)."
  type        = bool
  default     = true
}

variable "min_instance_count" {
  description = "Minimum running instances (0 = scale to zero, matching the Firebase App Hosting config)."
  type        = number
  default     = 0
}

variable "max_instance_count" {
  description = "Maximum running instances."
  type        = number
  default     = 4
}

variable "cpu" {
  description = "CPU allocation per instance."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory allocation per instance."
  type        = string
  default     = "512Mi"
}

variable "service_labels" {
  description = "Labels applied to the Artifact Registry repository and Cloud Run service."
  type        = map(string)
  default = {
    application = "f3-region-pages"
    managed_by  = "terraform"
  }
}

variable "secret_values" {
  description = <<-EOT
    Values for the Terraform-managed runtime secrets, keyed by their logical
    (Firebase) secret name. These are recreated as new `<name>-tf` secrets in
    Secret Manager to coexist with the Firebase App Hosting-managed originals
    during the migration. Supply via a gitignored terraform.tfvars seeded from
    `gcloud secrets versions access latest --secret=<name>`.

    Required keys: postgres-url, f3-data-warehouse-url,
    cloud-sql-warehouse-connection-name, warehouse-db-user,
    warehouse-db-password, warehouse-db-name, cron-secret,
    slack-bot-auth-token, slack-channel-id.
  EOT
  type        = map(string)
  sensitive   = true
}
