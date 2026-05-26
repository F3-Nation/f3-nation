# Cloud Run custom domain mappings — the free, no-load-balancer serving path.
#
# Cost: $0. Google issues + renews a managed TLS cert automatically and serves
# each domain directly from Cloud Run's frontend; there is no forwarding rule,
# target proxy, backend service, or reserved IP to bill. DNS for each domain is
# a single CNAME (subdomain -> ghs.googlehosted.com) instead of an A record.
#
# var.domain_mappings is the source of truth for which domains Cloud Run serves
# directly. Each domain must be verified once for this GCP account in Search
# Console (a one-time google-site-verification TXT) before Google activates the
# mapping. regions.f3nation.com is already live on a mapping (imported into
# state); staging.f3regions.com joins this list once f3regions.com is verified.
#
# The external HTTPS load balancer (lb.tf) is a transitional alternative kept
# only until staging.f3regions.com moves onto a mapping here; once it does, the
# load balancer is torn down (var.routing_mode -> the LB resources drop). See
# README for the migration trade-off write-up.

locals {
  domain_mappings = toset(var.domain_mappings)
}

resource "google_cloud_run_domain_mapping" "app" {
  for_each = local.domain_mappings

  project  = var.project_id
  location = var.region
  name     = each.value

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}
