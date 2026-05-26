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
  description = "DNS records Tackle adds when routing_mode = domain_mapping (subdomain -> CNAME ghs.googlehosted.com). Empty otherwise."
  value       = try(google_cloud_run_domain_mapping.app[0].status[0].resource_records, [])
}

output "dns_handoff" {
  description = "Copy/paste DNS instruction for Tackle, based on routing_mode."
  value = var.service_domain == "" ? "service_domain not set — no DNS change to hand off yet." : (
    var.routing_mode == "domain_mapping" ?
    "Verify ${var.service_domain} once in Search Console (google-site-verification TXT), then add: ${var.service_domain} -> CNAME ghs.googlehosted.com. (TTL 300). Free Google-managed cert auto-provisions after it resolves." :
    "Create an A record: ${var.service_domain} -> ${try(google_compute_global_address.lb[0].address, "(pending apply)")} (TTL 300). HTTPS cert auto-provisions within ~15-60 min after it resolves."
  )
}
