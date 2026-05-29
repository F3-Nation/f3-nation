# F3 Redirect

A multi-tenant service that redirects **custom domains** to arbitrary destination
URLs. Each request arrives at our redirect tier (because the tenant pointed their
DNS at us); we read the `Host` header, look up the target, and return a 301/302.
TLS certificates for those custom domains are issued **on demand** and stored in
GCS — no database anywhere.

## Mappings (current)

| Source                 | Destination                                         | DNS shape | DNS owner           |
| ---------------------- | --------------------------------------------------- | --------- | ------------------- |
| `f3muletown.com`       | `https://regions.f3nation.com/muletown`             | apex (A)  | Route 53 (us)       |
| `www.f3muletown.com`   | `https://regions.f3nation.com/muletown`             | CNAME     | Route 53 (us)       |
| `stats.f3muletown.com` | `https://pax-vault.f3nation.com/stats/region/35838` | CNAME     | Route 53 (us)       |
| `f3marshall.com`       | `https://regions.f3nation.com/marshall-tn`          | apex (A)  | external (hand-off) |
| `www.f3marshall.com`   | `https://regions.f3nation.com/marshall-tn`          | CNAME     | external (hand-off) |

## Architecture

- **Redirect tier (Go, `cmd/redirectd`).** Terminates TLS itself and emits the
  redirect. Because it owns port 443, it runs on **GCE** (Container-Optimized OS
  VM), not Cloud Run.
- **On-demand TLS via [CertMagic](https://github.com/caddyserver/certmagic).**
  Certs are obtained from Let's Encrypt the first time a registered host is seen,
  and stored in GCS (`internal/certstore`) so they're shared across instances and
  survive restarts. Issuance is **gated on the registry**: the decision function
  refuses to obtain a cert for a host that isn't in the config (abuse / rate-limit
  guard).
- **Config is a flat JSON file in GCS — no database** (`internal/mappings`). The
  same file is the registry the TLS gate consults. The server hot-reloads it on
  an interval, so new mappings take effect without a redeploy.
- **Admin CLI (Go, `cmd/f3redirect`).** Add/list/remove mappings and print the DNS
  records a tenant must create. A TypeScript management UI is deferred.

```text
cmd/redirectd      HTTPS redirect server (on-demand TLS)
cmd/f3redirect     admin CLI
internal/mappings  config model, resolve, validate, DNS instructions, stores (file + GCS)
internal/redirect  HTTP redirect handler + hot-reloading Live view
internal/certstore certmagic.Storage backed by GCS
internal/server    CertMagic wiring (gated on-demand issuance)
infra/terraform    GCS bucket, static IP, COS VM, firewall, Artifact Registry, IAM
```

## Local development

Run the CLI against a local file (no cloud needed):

```bash
cp config.example.json /tmp/redirects.json
go run ./cmd/f3redirect list --file /tmp/redirects.json
go run ./cmd/f3redirect dns  --file /tmp/redirects.json --static-ip 203.0.113.10
go run ./cmd/f3redirect add  --file /tmp/redirects.json example.com https://example.org
```

Run the server locally (cert storage is always GCS — set a bucket):

```bash
CONFIG_FILE=/tmp/redirects.json CERT_BUCKET=<bucket> ACME_STAGING=1 \
HTTP_ADDR=:8080 HTTPS_ADDR=:8443 ACME_EMAIL=you@example.com \
  go run ./cmd/redirectd
```

## Tests & coverage

```bash
go test ./...
bash scripts/coverage.sh           # enforces a coverage threshold (default 70%)
```

The gate covers the business-logic packages (`internal/mappings`,
`internal/redirect`). Cloud-IO packages (`internal/certstore`, `internal/server`)
and the `cmd/` entrypoints are validated by the deploy-time smoke test instead.
Coverage artifacts (`coverage.out`, `coverage.html`) are gitignored.

## Deploy (Terraform)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set project + acme_email
terraform init
terraform apply
```

Provisions: a GCS bucket (config + certs), a reserved **static IP** (apex
A-records point here), an Artifact Registry repo, a COS VM running `redirectd` on
the host network (ports 80/443), a firewall for 80/443, and a runtime service
account with object access + image-pull rights. Key outputs: `static_ip`,
`bucket`, `artifact_registry`.

Seed the config once (thereafter, manage it with the CLI):

```bash
gcloud storage cp config.example.json gs://<bucket>/config/redirects.json
```

## CI/CD (GitHub → Google Cloud)

Now that this app lives in the F3 Nation monorepo, it shares the repo-wide CI
and has its own deploy workflows:

- **CI** (`.github/workflows/ci.yml`, repo root): the shared Turborepo pipeline
  runs `lint`, `typecheck`, `build`, `test`, and `test-coverage` across all
  packages. The Go tier participates as a turbo workspace package (its
  `package.json` shells to `go` via `scripts/*.sh`); the workflow installs Go
  with `actions/setup-go` so those tasks run in CI.
- **CD — redirect tier** (`.github/workflows/deploy-redirect-server.yml`): on
  **push to `dev`** (path-filtered to the Go tier + its Dockerfile), builds and
  pushes the image to Artifact Registry and rolls the COS VM (which re-pulls
  `:latest` on boot).
- **CD — admin web** (`.github/workflows/deploy-redirect-web.yml`): on **push to
  `dev`** (path-filtered to `apps/redirect/web/**`), builds the turbo-pruned
  image and deploys to Cloud Run.

There is a single production environment: **merging to `dev` deploys to prod**
(no separate staging for this app). Auth is **keyless via Workload Identity
Federation** — no SA keys.

> The Go image is built with `--provenance=false` so it's a plain single-arch
> manifest; the COS docker on the VM does not reliably pull buildx OCI indexes
> that carry an attestation manifest.

## DNS

Apex domains can't CNAME, so they use an **A record to the static IP**;
subdomains **CNAME** to the apex (which carries that A record). Generate the exact
records with:

```bash
f3redirect dns --bucket <bucket> --static-ip <STATIC_IP>
```

Muletown's records live in our Route 53 zone and are managed here. Marshall's
domain is controlled by a third party — hand them the `dns` output for
`f3marshall.com` / `www.f3marshall.com`.
