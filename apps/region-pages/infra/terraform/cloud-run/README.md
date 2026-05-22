# f3-region-pages — Cloud Run (Terraform)

> **MONOREPO NOTE (2026-05):** region-pages now lives at `apps/region-pages` in
> the F3 Nation monorepo. The Terraform **resources are unchanged** (same GCP
> project `region-pages`, same LB/Cloud Run/secrets). What changed is the
> **image build context**: build from the **monorepo root** with the app's
> Dockerfile, e.g.
>
> ```bash
> # from the monorepo root
> DOCKER_BUILDKIT=1 docker buildx build -f apps/region-pages/Dockerfile \
>   --platform linux/amd64 --provenance=false --load \
>   --secret id=postgres_url,src=./.secrets/postgres_url \
>   --secret id=warehouse_url,src=./.secrets/warehouse_url \
>   -t us-central1-docker.pkg.dev/region-pages/f3-region-pages/web:<tag> .
> ```
>
> The `image` tag still feeds the Terraform `image` var exactly as before. The
> `docker build ... .` command in the standalone runbook below is superseded by
> the monorepo command above.

Deploys the region-pages Next.js app to **Google Cloud Run** in the
**`region-pages`** GCP project, replacing the opaque Firebase App Hosting
mechanism with explicit infrastructure as code.

This stack runs **alongside** the existing Firebase App Hosting backend during
the migration. It makes **no DNS change** — `regions.f3nation.com` keeps pointing
at Firebase until the F3 Nation dev team (Tackle) performs the cutover.

## What it provisions

- Artifact Registry Docker repo (`f3-region-pages`)
- A runtime service account (`f3-region-pages-run`) with `roles/cloudsql.client`
  (for the warehouse Cloud SQL connector)
- The 9 runtime secrets, **recreated** as Terraform-managed `…-tf` secrets in
  Secret Manager (see "Secret duplication" below)
- A `google_cloud_run_v2_service` (`f3-region-pages`) on port 8080, public, with
  all secrets wired in plus `WAREHOUSE_DB_CONNECTION_MODE=connector`
- When `service_domain` is set: an external HTTPS load balancer (`lb.tf`) — static
  anycast IP, serverless NEG, Google-managed TLS cert, and an HTTP→HTTPS redirect

## Prerequisites

- `gcloud` authenticated as an account with access to `region-pages`
  (`gcloud config set account patrick@pstaylor.net && gcloud config set project region-pages`)
- `terraform >= 1.5`, Docker with BuildKit

## Deploy

```bash
cd infra/terraform/cloud-run

# 0. One-time: create the remote state bucket (matches versions.tf backend).
gcloud storage buckets create gs://region-pages-tfstate \
  --project=region-pages --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets update gs://region-pages-tfstate --versioning

# 1. Seed terraform.tfvars from the existing Firebase secrets.
cp terraform.tfvars.example terraform.tfvars
# For each key, paste the value from:
#   gcloud secrets versions access latest --secret=<name> --project=region-pages

# 2. Init + create the Artifact Registry repo first (the image lands there).
terraform init
terraform apply -target=google_artifact_registry_repository.containers

# 3. Build and push the image (build needs DB access for generateStaticParams).
gcloud auth configure-docker us-central1-docker.pkg.dev
mkdir -p .secrets
gcloud secrets versions access latest --secret=postgres-url        --project=region-pages > .secrets/postgres_url
gcloud secrets versions access latest --secret=f3-data-warehouse-url --project=region-pages > .secrets/warehouse_url
DOCKER_BUILDKIT=1 docker build \
  --secret id=postgres_url,src=.secrets/postgres_url \
  --secret id=warehouse_url,src=.secrets/warehouse_url \
  -t us-central1-docker.pkg.dev/region-pages/f3-region-pages/web:v1 \
  ../../..
docker push us-central1-docker.pkg.dev/region-pages/f3-region-pages/web:v1
rm -rf .secrets

# 4. Set `image` in terraform.tfvars to the pushed tag, then apply the full stack.
terraform apply

# 5. Verify.
terraform output service_url
```

## Secret duplication (migration debt)

Firebase App Hosting created Secret Manager secrets named `postgres-url`,
`cron-secret`, etc. This stack creates **parallel** copies suffixed `-tf`
(`postgres-url-tf`, …) so both deployments work during the messy middle. Once
Cloud Run is the production path and Firebase App Hosting is decommissioned,
**delete the original (un-suffixed) Firebase secrets**. Terraform is the source
of truth from that point on.

## DNS cutover (hand-off to Tackle)

The custom domain is served by an external HTTPS load balancer rather than a
Cloud Run domain mapping — this avoids Search Console / Webmaster domain
verification. The Google-managed certificate validates automatically once the
domain resolves to the load balancer IP, so the only DNS change is one A record:

1. `terraform apply` with `service_domain` set (allocates the static IP + LB).
2. Hand the `dns_handoff` output to the F3 Nation dev team (Tackle), e.g.:
   `A  regions.f3nation.com  ->  <load_balancer_ip>  (TTL 300)`.
3. Once the A record resolves, the managed cert provisions in ~15–60 min and the
   LB serves HTTPS. Verify with `curl -I https://regions.f3nation.com/`.

No `regions.f3nation.com` change is made by this stack — Tackle owns the zone.
