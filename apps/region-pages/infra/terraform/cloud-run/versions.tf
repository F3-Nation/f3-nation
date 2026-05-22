terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state in the region-pages project. Bucket is created out-of-band
  # before `terraform init` (see README). State for this stack lives under the
  # cloud-run/ prefix so other stacks can share the bucket later.
  backend "gcs" {
    bucket = "region-pages-tfstate"
    prefix = "cloud-run"
  }
}
