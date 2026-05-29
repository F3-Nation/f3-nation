terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state so the drift-detection CI (see
  # .github/workflows/redirect-terraform-drift.yml) can read the same state a
  # local apply writes. Bucket created out-of-band (bootstrap infra is not
  # self-managed): gs://f3-redirects-tfstate (versioned, UBLA, PAP enforced).
  backend "gcs" {
    bucket = "f3-redirects-tfstate"
    prefix = "redirect"
  }
}

provider "google" {
  project = var.project
  region  = var.region
  zone    = var.zone
}
