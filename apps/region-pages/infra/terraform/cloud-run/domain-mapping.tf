# Cloud Run custom domain mapping — the cheap alternative to the global external
# load balancer in lb.tf.
#
# Cost: $0. Google issues + renews a managed TLS cert automatically and serves
# the domain directly from Cloud Run's frontend; there is no forwarding rule,
# target proxy, backend service, or reserved IP to bill. Tackle adds a single
# CNAME (subdomain -> ghs.googlehosted.com) instead of an A record.
#
# Prerequisite: the domain must be verified once for this GCP account in Search
# Console (a one-time google-site-verification TXT). Until routing_mode is
# "domain_mapping" this resource is inert and the LB (lb.tf) stays in place.
#
# Trade-offs vs. the LB (all capabilities we do NOT currently use): no Cloud CDN
# edge caching, no Cloud Armor WAF/rate-limiting, no static anycast IP for
# allowlisting, single-region only, Google-managed cert only (no custom SSL
# policy), and apex domains are unsupported (subdomains only — regions.f3nation.com
# qualifies). See the PR discussion for the full trade-off write-up.

locals {
  enable_domain_mapping = var.service_domain != "" && var.routing_mode == "domain_mapping" ? 1 : 0
}

resource "google_cloud_run_domain_mapping" "app" {
  count    = local.enable_domain_mapping
  project  = var.project_id
  location = var.region
  name     = var.service_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}
