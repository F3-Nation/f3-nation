output "service_url" {
  description = "Cloud Run *.run.app URL for the region-pages app."
  value       = google_cloud_run_v2_service.app.uri
}

output "artifact_registry_repository_url" {
  description = "Artifact Registry path prefix for docker pushes."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "runtime_service_account_email" {
  description = "Runtime service account email for the Cloud Run service."
  value       = google_service_account.runtime.email
}

output "load_balancer_ip" {
  description = "Static anycast IP of the external HTTPS load balancer. Hand this to the F3 Nation dev team (Tackle): create an A record for service_domain pointing here. Empty until service_domain is set."
  value       = try(google_compute_global_address.lb[0].address, "")
}

output "managed_certificate_domains" {
  description = "Domains on the Google-managed TLS certificate. The cert auto-provisions once the A record resolves to load_balancer_ip."
  value       = try(google_compute_managed_ssl_certificate.lb[0].managed[0].domains, [])
}

output "domain_mapping_dns_records" {
  description = "Per-domain DNS records for each Cloud Run domain mapping (subdomain -> CNAME ghs.googlehosted.com). Keyed by domain."
  value       = { for d, m in google_cloud_run_domain_mapping.app : d => try(m.status[0].resource_records, []) }
}

output "dns_handoff" {
  description = "Copy/paste DNS instructions per domain mapping, plus any transitional load-balancer A record."
  value = merge(
    { for d in var.domain_mappings : d => "Verify ${d} once in Search Console (google-site-verification TXT), then add: ${d} -> CNAME ghs.googlehosted.com (TTL 300). Free Google-managed cert auto-provisions after it resolves." },
    var.service_domain == "" ? {} : {
      "${var.service_domain} (transitional LB)" = "Create an A record: ${var.service_domain} -> ${try(google_compute_global_address.lb[0].address, "(pending apply)")} (TTL 300)."
    }
  )
}
