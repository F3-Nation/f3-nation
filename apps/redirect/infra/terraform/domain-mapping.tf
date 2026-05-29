# Admin web tier (Cloud Run) front door.
#
# The redirect VM can reverse-proxy the admin host (var.admin_host), but routing
# the admin control-plane through the single-instance redirect VM couples admin
# availability to the redirect data-plane: a VM redeploy/restart takes the admin
# dashboard down with it. A Cloud Run custom domain mapping gives admin its own
# front door — free, Google-managed TLS, no load balancer — so it stays up
# independently and offloads admin TLS off the VM's on-demand Let's Encrypt.
#
# DNS handoff: admin.f3regions.com  CNAME -> ghs.googlehosted.com
# The domain must be verified once in Search Console for the operating account.
resource "google_cloud_run_domain_mapping" "admin" {
  count    = var.admin_domain == "" ? 0 : 1
  name     = var.admin_domain
  location = var.region

  metadata {
    namespace = var.project
  }

  spec {
    route_name = var.admin_service_name
  }
}
