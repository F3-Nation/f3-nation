output "static_ip" {
  description = "Reserved public IP. Apex A-records (and the canonical host) point here."
  value       = google_compute_address.redirect.address
}

output "bucket" {
  description = "GCS bucket holding the flat-file config and TLS certs."
  value       = google_storage_bucket.data.name
}

output "config_object" {
  description = "Full gs:// path of the flat-file config."
  value       = "gs://${google_storage_bucket.data.name}/${var.config_object}"
}

output "image" {
  description = "Container image the VM runs."
  value       = local.image
}

output "instance" {
  description = "Redirect VM name."
  value       = google_compute_instance.redirect.name
}

output "artifact_registry" {
  description = "Artifact Registry Docker repo URL."
  value       = "${var.region}-docker.pkg.dev/${var.project}/${google_artifact_registry_repository.repo.repository_id}"
}

output "admin_domain_dns" {
  description = "DNS record to create for the admin Cloud Run domain mapping (CNAME -> rrdata)."
  value = var.admin_domain == "" ? null : {
    for r in google_cloud_run_domain_mapping.admin[0].status[0].resource_records :
    r.name => { type = r.type, rrdata = r.rrdata }
  }
}
