variable "project" {
  type        = string
  description = "GCP project ID."
  default     = "f3-redirects"
}

variable "region" {
  type        = string
  description = "GCP region."
  default     = "us-central1"
}

variable "zone" {
  type        = string
  description = "GCP zone for the redirect VM."
  default     = "us-central1-a"
}

variable "name" {
  type        = string
  description = "Base name for resources."
  default     = "redirect"
}

variable "machine_type" {
  type        = string
  description = "GCE machine type for the redirect VM."
  default     = "e2-small"
}

variable "acme_email" {
  type        = string
  description = "Let's Encrypt account contact email."
}

variable "acme_staging" {
  type        = bool
  description = "Use the Let's Encrypt staging CA (untrusted certs, high rate limits)."
  default     = false
}

variable "redirect_status" {
  type        = string
  description = "HTTP redirect status code (301 or 302)."
  default     = "302"

  validation {
    condition     = contains(["301", "302"], var.redirect_status)
    error_message = "redirect_status must be \"301\" or \"302\"."
  }
}

variable "image_tag" {
  type        = string
  description = "Container image tag to run."
  default     = "latest"
}

variable "config_object" {
  type        = string
  description = "GCS object path of the flat-file config."
  default     = "config/redirects.json"
}

variable "cert_prefix" {
  type        = string
  description = "GCS prefix under the bucket for shared cert storage."
  default     = "certs"
}

variable "admin_host" {
  type        = string
  description = "Hostname the redirect tier reverse-proxies to the admin web app (empty disables). Configurable so it can move (e.g. admin.regions.f3nation.com)."
  default     = ""
}

variable "admin_upstream" {
  type        = string
  description = "Upstream URL for the admin host (e.g. the Cloud Run service URL)."
  default     = ""
}

variable "admin_domain" {
  type        = string
  description = <<-EOT
    Custom domain served directly by a Cloud Run domain mapping for the admin
    web tier (free, Google-managed TLS, no load balancer; DNS is a CNAME to
    ghs.googlehosted.com). Empty disables the mapping (falls back to the VM
    reverse-proxy via admin_host).
  EOT
  default     = "admin.f3regions.com"
}

variable "admin_service_name" {
  type        = string
  description = "Name of the Cloud Run service backing the admin domain mapping."
  default     = "f3redirect-web"
}
