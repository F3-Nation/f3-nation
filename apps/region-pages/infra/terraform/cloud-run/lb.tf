# Global external Application Load Balancer in front of the Cloud Run service.
#
# Why not a Cloud Run domain mapping? Domain mappings require Search Console /
# Webmaster ownership verification of the domain before Google will activate
# them. A load balancer with a Google-managed certificate validates the domain
# automatically once its A record resolves to the LB IP — so the only DNS change
# handed to the F3 Nation dev team (Tackle) is a single A record to a stable
# anycast IP.
#
# All resources are gated on var.service_domain: empty (default) builds nothing.

locals {
  enable_lb = var.service_domain == "" ? 0 : 1
}

# Stable anycast IP — this is the value Tackle points the A record at.
resource "google_compute_global_address" "lb" {
  count   = local.enable_lb
  project = var.project_id
  name    = "${var.service_name}-lb-ip"
}

# Serverless NEG targeting the Cloud Run service.
resource "google_compute_region_network_endpoint_group" "serverless" {
  count                 = local.enable_lb
  project               = var.project_id
  name                  = "${var.service_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }
}

resource "google_compute_backend_service" "lb" {
  count                 = local.enable_lb
  project               = var.project_id
  name                  = "${var.service_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.serverless[0].id
  }
}

# Google-managed TLS certificate. Provisions automatically once DNS resolves to
# google_compute_global_address.lb; until then it sits in PROVISIONING.
resource "google_compute_managed_ssl_certificate" "lb" {
  count   = local.enable_lb
  project = var.project_id
  name    = "${var.service_name}-cert"

  managed {
    domains = [var.service_domain]
  }
}

resource "google_compute_url_map" "lb" {
  count           = local.enable_lb
  project         = var.project_id
  name            = "${var.service_name}-urlmap"
  default_service = google_compute_backend_service.lb[0].id
}

resource "google_compute_target_https_proxy" "lb" {
  count            = local.enable_lb
  project          = var.project_id
  name             = "${var.service_name}-https-proxy"
  url_map          = google_compute_url_map.lb[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.lb[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.enable_lb
  project               = var.project_id
  name                  = "${var.service_name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.lb[0].id
  ip_address            = google_compute_global_address.lb[0].id
}

# Port 80 -> 443 redirect so plain-HTTP requests upgrade to HTTPS.
resource "google_compute_url_map" "redirect" {
  count   = local.enable_lb
  project = var.project_id
  name    = "${var.service_name}-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count   = local.enable_lb
  project = var.project_id
  name    = "${var.service_name}-http-proxy"
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.enable_lb
  project               = var.project_id
  name                  = "${var.service_name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
  ip_address            = google_compute_global_address.lb[0].id
}
