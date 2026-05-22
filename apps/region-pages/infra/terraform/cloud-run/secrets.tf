locals {
  # Logical (Firebase) secret name => Cloud Run environment variable name.
  # The Terraform-managed copies are created with a "-tf" suffix so they coexist
  # with the Firebase App Hosting-managed originals during the migration.
  runtime_secrets = {
    "postgres-url"                        = "POSTGRES_URL"
    "f3-data-warehouse-url"               = "F3_DATA_WAREHOUSE_URL"
    "cloud-sql-warehouse-connection-name" = "CLOUD_SQL_WAREHOUSE_CONNECTION_NAME"
    "warehouse-db-user"                   = "WAREHOUSE_DB_USER"
    "warehouse-db-password"               = "WAREHOUSE_DB_PASSWORD"
    "warehouse-db-name"                   = "WAREHOUSE_DB_NAME"
    "cron-secret"                         = "CRON_SECRET"
    "slack-bot-auth-token"                = "SLACK_BOT_AUTH_TOKEN"
    "slack-channel-id"                    = "SLACK_CHANNEL_ID"
  }

  secret_suffix = "-tf"
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.runtime_secrets

  project   = var.project_id
  secret_id = "${each.key}${local.secret_suffix}"
  labels    = var.service_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "runtime" {
  for_each = local.runtime_secrets

  secret      = google_secret_manager_secret.runtime[each.key].id
  secret_data = var.secret_values[each.key]
}

# Allow the Cloud Run runtime service account to read each secret.
resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = local.runtime_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
