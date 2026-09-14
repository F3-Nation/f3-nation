# Analytics ETL GCP provisioning

This manual bootstrap guide is not live-state validation. Platform, security,
database, analytics, and consumer owners must approve the exact grants and
production release. See the [ETL spec](../specs/analytics-parquet-etl.md) for
the data contract and [ETL operations](ANALYTICS_ETL_OPERATIONS.md) for
recovery. Use [GCP_APP_SETUP](GCP_APP_SETUP.md) for generic Cloud Run setup and
shared WIF guidance; do not recreate its shared WIF pool/provider.

## Fixed contract

Both jobs use project `f3data`, region `us-central1`, and Artifact Registry
repository `cloud-run-builds`. Nonprod is job `analytics-etl-nonprod`, Cloud SQL
`f3data-nonprod`, database `f3_staging`, and bucket
`gs://f3-analytics-nonprod`. Production is job `analytics-etl`, Cloud SQL
`f3data`, database `f3_prod`, and bucket `gs://f3-analytics`. Published objects
are under `parquets/releases/<run-id>/<dataset>/`; the fixed catalog is
`parquets/catalog.json`.
Runtime SAs are `analytics-etl-nonprod@f3data.iam.gserviceaccount.com` and
`analytics-etl@f3data.iam.gserviceaccount.com`. Nonprod is manual only;
production is scheduled daily. Jobs have one task, parallelism one, zero task
retries, and a 60-minute timeout. CI builds once and deploys by digest; it does
not grant IAM or create schedules.

## 1. Prerequisites and APIs

Use Bash from the repository root with authenticated `gcloud` and `gh`, and an
operator account authorized for `f3data`, `f3-github`, Cloud SQL, Secret
Manager, and the buckets. Never create service-account keys. Obtain explicit
approval for sensitive output and for production load, freshness/SLO,
retention, encryption, rollback, and consumer access. Confirm both Cloud SQL
instances and the existing `github-actions` pool and `github` provider in
`f3-github`; this guide does not claim that they exist.

```bash
set -euo pipefail
PROJECT_ID="f3data"
REGION="us-central1"
WIF_PROJECT="f3-github"
GITHUB_REPOSITORY="F3-Nation/f3-nation"
NONPROD_JOB="analytics-etl-nonprod"
PROD_JOB="analytics-etl"
NONPROD_BUCKET="f3-analytics-nonprod"
PROD_BUCKET="f3-analytics"
NONPROD_RUNTIME_SA="analytics-etl-nonprod@${PROJECT_ID}.iam.gserviceaccount.com"
PROD_RUNTIME_SA="analytics-etl@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="analytics-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
printf '%s\n' "project=$PROJECT_ID region=$REGION jobs=$NONPROD_JOB,$PROD_JOB"
```

```bash
gcloud services enable artifactregistry.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com iamcredentials.googleapis.com logging.googleapis.com run.googleapis.com secretmanager.googleapis.com serviceusage.googleapis.com sqladmin.googleapis.com sts.googleapis.com storage.googleapis.com --project="$PROJECT_ID"
gcloud services enable cloudresourcemanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$WIF_PROJECT"
gcloud iam workload-identity-pools describe github-actions --location=global --project="$WIF_PROJECT"
gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github-actions --project="$WIF_PROJECT"
```

## 2. Artifact Registry

Create the repository only if absent; never delete/recreate it. The workflow
uses image `analytics-etl` in this repository.

```bash
gcloud artifacts repositories describe cloud-run-builds --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 || gcloud artifacts repositories create cloud-run-builds --repository-format=docker --location="$REGION" --project="$PROJECT_ID" --description='Cloud Run deployment images'
```

## 3. WIF deployers and GitHub environments

Prefer separate deployment identities. Names are operator choices; they are not
runtime or Scheduler identities.

```bash
NONPROD_DEPLOY_NAME="ANALYTICS-NONPROD-DEPLOY"
PROD_DEPLOY_NAME="ANALYTICS-PROD-DEPLOY"
NONPROD_DEPLOY_SA="${NONPROD_DEPLOY_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROD_DEPLOY_SA="${PROD_DEPLOY_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts create "$NONPROD_DEPLOY_NAME" --display-name='Analytics nonprod GitHub deployer' --project="$PROJECT_ID"
gcloud iam service-accounts create "$PROD_DEPLOY_NAME" --display-name='Analytics production GitHub deployer' --project="$PROJECT_ID"
```

Grant only approved deployment access: Run deploy, service-account use,
Service Usage Viewer, and Artifact Registry write. Constrain to named jobs and
the repository where supported. Production promotion in this same project
also requires AR read.

```bash
for SA in "$NONPROD_DEPLOY_SA" "$PROD_DEPLOY_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role=roles/run.admin
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role=roles/iam.serviceAccountUser
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role=roles/serviceusage.serviceUsageViewer
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role=roles/artifactregistry.writer
done
WIF_PROJECT_NUMBER="$(gcloud projects describe "$WIF_PROJECT" --format='value(projectNumber)')"
WIF_PRINCIPAL="principalSet://iam.googleapis.com/projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository/${GITHUB_REPOSITORY}"
gcloud iam service-accounts add-iam-policy-binding "$NONPROD_DEPLOY_SA" --role=roles/iam.workloadIdentityUser --member="$WIF_PRINCIPAL" --project="$PROJECT_ID"
gcloud iam service-accounts add-iam-policy-binding "$PROD_DEPLOY_SA" --role=roles/iam.workloadIdentityUser --member="$WIF_PRINCIPAL" --project="$PROJECT_ID"
```

Create the nonprod environment without protection rules. Create/update
production with the current GitHub user as a required reviewer, then set only
variables (WIF means no GitHub credential secret).

```bash
GH_REPO="$GITHUB_REPOSITORY"
NONPROD_GH_ENV="analytics-nonprod"
PROD_GH_ENV="analytics-production"
WIF_PROVIDER="projects/${WIF_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/providers/github"
gh api "repos/${GH_REPO}/environments/${NONPROD_GH_ENV}" --method PUT
REVIEWER_ID="$(gh api user -q '.id')"
[[ "$REVIEWER_ID" =~ ^[0-9]+$ ]]
gh api "repos/${GH_REPO}/environments/${PROD_GH_ENV}" --method PUT --input - <<EOF
{
  "reviewers": [{ "type": "User", "id": ${REVIEWER_ID} }]
}
EOF
gh variable set WIF_PROVIDER --env "$NONPROD_GH_ENV" --repo "$GH_REPO" --body "$WIF_PROVIDER"
gh variable set WIF_SA --env "$NONPROD_GH_ENV" --repo "$GH_REPO" --body "$NONPROD_DEPLOY_SA"
gh variable set WIF_PROVIDER --env "$PROD_GH_ENV" --repo "$GH_REPO" --body "$WIF_PROVIDER"
gh variable set WIF_SA --env "$PROD_GH_ENV" --repo "$GH_REPO" --body "$PROD_DEPLOY_SA"
```

The tag trigger is `analytics@*`; CI waits for its checks, builds once, deploys
nonprod, then reaches the production environment gate.

## 4. Runtime SAs and role matrix

```bash
gcloud iam service-accounts create analytics-etl-nonprod --display-name='Analytics ETL nonprod runtime' --project="$PROJECT_ID"
gcloud iam service-accounts create analytics-etl --display-name='Analytics ETL production runtime' --project="$PROJECT_ID"
```

| Identity           | Minimum grant and scope                                                                                                       | Explicitly excluded                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Nonprod runtime    | Cloud SQL Client on `f3data`; accessor on its two secrets; approved GCS release create/get plus exact catalog metadata update | Production, DB write/DDL/admin, object deletion/content overwrite |
| Production runtime | Same grants, restricted to production resources and release prefix/catalog object                                             | Nonprod, DB write/DDL/admin, object deletion/content overwrite    |
| Scheduler          | `roles/run.invoker` on `analytics-etl` only                                                                                   | Storage, secrets, deploy, Scheduler admin                         |
| PAX Vault consumer | Separate get-only catalog reader and release reader bindings                                                                  | Write, catalog mutation, end-user access                          |
| GitHub deployer    | Run deploy, SA use, AR build/promote, usage viewer                                                                            | Runtime data, Scheduler admin, Owner/Editor                       |

Never grant runtime SAs `roles/editor`, bucket admin, or database admin.

## 5. Cloud SQL IAM and database roles

```bash
for SA in "$NONPROD_RUNTIME_SA" "$PROD_RUNTIME_SA" "$NONPROD_DEPLOY_SA" "$PROD_DEPLOY_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role=roles/cloudsql.client
done
```

The deployers additionally need Service Usage Viewer (already included above’s
deployment matrix). A database owner must create/verify one dedicated login
and approved read-only role per database. Exact SQL is intentionally not
prescribed: schema ownership, table/future-table grants, and migrations are
human-owned. The roles must have no INSERT, UPDATE, DELETE, DDL, ownership,
admin privileges, or access to other databases.

```text
NONPROD_LOGIN=<approved_nonprod_database_login>
NONPROD_READ_ROLE=<approved_nonprod_read_only_role>
PROD_LOGIN=<approved_prod_database_login>
PROD_READ_ROLE=<approved_prod_read_only_role>
# Database owner: apply approved read-only grants to f3_staging and f3_prod.
```

The workflow uses sockets `/cloudsql/f3data:us-central1:f3data-nonprod` and
`/cloudsql/f3data:us-central1:f3data`. Verify write denial in nonprod.

## 6. Secret Manager

Workflow names are nonprod `analytics-etl-nonprod-database-user` and
`analytics-etl-nonprod-database-password`; production
`analytics-etl-database-user` and `analytics-etl-database-password`.

```bash
create_secret_if_missing() { local NAME="$1"; gcloud secrets describe "$NAME" --project="$PROJECT_ID" >/dev/null 2>&1 || gcloud secrets create "$NAME" --replication-policy=automatic --project="$PROJECT_ID"; }
for SECRET in analytics-etl-nonprod-database-user analytics-etl-nonprod-database-password analytics-etl-database-user analytics-etl-database-password; do create_secret_if_missing "$SECRET"; done
SECRET_NAME="<ONE_SECRET_NAME_FROM_TABLE>"
read -r -s -p 'Approved secret value (will not echo): ' SECRET_VALUE; printf '\n'
printf '%s' "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" --data-file=- --project="$PROJECT_ID"
unset SECRET_VALUE SECRET_NAME
```

Grant accessor only on matching secrets (repeat with the production pair and
`PROD_RUNTIME_SA`):

```bash
for SECRET in analytics-etl-nonprod-database-user analytics-etl-nonprod-database-password; do
  gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:${NONPROD_RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --project="$PROJECT_ID"
done
```

Never place values in workflow files, this document, logs, shell history, or
source control. After rotation, add a version, validate nonprod, approve
production, then revoke the old version.

## 7. GCS buckets and prefix IAM

Verify owner-approved location, retention, encryption/key, lifecycle, and
existence. Do not create absent buckets with guessed settings.

```bash
gcloud storage buckets describe "gs://$NONPROD_BUCKET" --project="$PROJECT_ID"
gcloud storage buckets describe "gs://$PROD_BUCKET" --project="$PROJECT_ID"
```

The publisher needs reviewed `storage.objects.get` and `create` on release
paths, but not delete or content overwrite. No bucket-level object listing is
required; consumers resolve objects from the pinned manifests.
`storage.objects.update` is needed only for metadata patches to the fixed
catalog object. Predefined `roles/storage.objectUser` is broader than the
contract. Platform must create separate custom roles omitting delete and broad
object update.

```bash
GCS_PUBLISHER_ROLE_ID="analyticsReleaseAccess"
PUBLISHER_ROLE="projects/${PROJECT_ID}/roles/${GCS_PUBLISHER_ROLE_ID}"
gcloud storage buckets add-iam-policy-binding "gs://$NONPROD_BUCKET" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${NONPROD_RUNTIME_SA}" \
  --role="$PUBLISHER_ROLE" \
  --condition='title=Analytics nonprod release objects,expression=resource.name.startsWith("projects/_/buckets/f3-analytics-nonprod/objects/parquets/releases/")'
gcloud storage buckets add-iam-policy-binding "gs://$PROD_BUCKET" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${PROD_RUNTIME_SA}" \
  --role="$PUBLISHER_ROLE" \
  --condition='title=Analytics production release objects,expression=resource.name.startsWith("projects/_/buckets/f3-analytics/objects/parquets/releases/")'
```

Grant catalog metadata update separately, with an exact object condition; do
not add update to the release-prefix binding:

```bash
PUBLISHER_CATALOG_ROLE="projects/${PROJECT_ID}/roles/analyticsCatalogMetadata"
gcloud storage buckets add-iam-policy-binding "gs://$NONPROD_BUCKET" \
  --member="serviceAccount:${NONPROD_RUNTIME_SA}" --role="$PUBLISHER_CATALOG_ROLE" \
  --condition='title=Analytics nonprod catalog only,expression=resource.name=="projects/_/buckets/f3-analytics-nonprod/objects/parquets/catalog.json"'
gcloud storage buckets add-iam-policy-binding "gs://$PROD_BUCKET" \
  --member="serviceAccount:${PROD_RUNTIME_SA}" --role="$PUBLISHER_CATALOG_ROLE" \
  --condition='title=Analytics production catalog only,expression=resource.name=="projects/_/buckets/f3-analytics/objects/parquets/catalog.json"'
```

`analyticsCatalogMetadata` is an owner-created custom role containing only
catalog get/create/update permissions required for metadata CAS. Neither role
contains delete permission or permits replacing existing release content.

Grant PAX Vault two separate get-only custom reader bindings: one exact
`parquets/catalog.json` object and one `parquets/releases/` prefix. Do not grant
`storage.objects.list` or use a broad bucket viewer role. The exact resource
conditions are:

```text
projects/_/buckets/<bucket>/objects/parquets/catalog.json
projects/_/buckets/<bucket>/objects/parquets/releases/
```

Security must approve uniform access, encryption, audit retention, and
GC/retention. Consumers cannot mutate catalog metadata.

For the approved PAX Vault identity, grant those two get-only roles separately
(the roles contain `storage.objects.get` and no list permission):

```bash
PAX_VAULT_SA="<approved-pax-vault-service-account>"
PAX_CATALOG_READER_ROLE="projects/${PROJECT_ID}/roles/analyticsCatalogReader"
PAX_RELEASE_READER_ROLE="projects/${PROJECT_ID}/roles/analyticsReleaseReader"
gcloud storage buckets add-iam-policy-binding "gs://$NONPROD_BUCKET" \
  --member="serviceAccount:${PAX_VAULT_SA}" --role="$PAX_CATALOG_READER_ROLE" \
  --condition='title=PAX catalog read,expression=resource.name=="projects/_/buckets/f3-analytics-nonprod/objects/parquets/catalog.json"'
gcloud storage buckets add-iam-policy-binding "gs://$NONPROD_BUCKET" \
  --member="serviceAccount:${PAX_VAULT_SA}" --role="$PAX_RELEASE_READER_ROLE" \
  --condition='title=PAX release read,expression=resource.name.startsWith("projects/_/buckets/f3-analytics-nonprod/objects/parquets/releases/")'
```

Repeat the two bindings for the production bucket only after the production
consumer gate. Replace the placeholder identity with the approved external
owner's identity; do not grant these roles to the producer runtime account.

## 8. Ordered consumer/IAM migration

This migration is human-approved and must be performed separately for nonprod
and production. PAX Vault owners own the consumer rollout; analytics/platform
owners own producer validation. Retain legacy consumer-read access until the
consumer has proven the new catalog chain; the broad legacy runtime binding is
removed earlier, before isolation validation.

1. **Preflight PAX Vault.** With the catalog absent, verify that the consumer
   can use its approved legacy pointer compatibility path and that it can read
   a generation-pinned release manifest and its eight dataset manifests. Record
   the compatibility result and the external owner.
2. **Install replacement bindings.** Add the release-data get/create binding and the
   exact-catalog get/create/update binding above. Do not grant update or delete
   on release data; do not grant bucket object listing.
3. **Remove broad runtime access.** Remove the runtime service account's broad
   legacy `analyticsBucketAccess` binding now, before producer execution or
   permission validation. Keep any legacy consumer read access needed for the
   compatibility period. Preserve the prior IAM policy as the approved,
   reversible rollback artifact.
4. **Validate permissions.** As the producer and consumer identities, verify
   allowed/denied operations against both environments. Confirm catalog
   metadata update is limited to
   `projects/_/buckets/<bucket>/objects/parquets/catalog.json`.
5. **Deploy and run nonprod.** Deploy the immutable producer, execute one
   complete nonprod batch, and verify that `release.json` is written last and
   catalog CAS succeeds.
6. **Validate the pinned chain.** Independently read catalog metadata, fetch
   the pinned release manifest generation, and verify exactly eight pinned
   dataset manifests and their object generations/checksums.
7. **Switch PAX Vault.** After consumer-owner approval, switch discovery to
   catalog metadata and monitor one complete consumption cycle.
8. **Remove legacy consumer access when safe.** After the switch and
   verification, remove only obsolete legacy consumer access, if approved.

If migration fails, stop at the last safe step and restore the prior runtime or
consumer IAM binding from the recorded policy snapshot, with human approval.
This rollback changes IAM only; it does not overwrite or delete any GCS object.
If catalog metadata was already activated, use the documented generation-pinned
metadata-CAS rollback and retain its source high-water value.

## 9. Jobs and production Scheduler

The tagged workflow supplies runtime SA, SQL settings, secrets, resources,
timeout, and retries. Inspect after deploy:

```bash
gcloud run jobs describe "$NONPROD_JOB" --region="$REGION" --project="$PROJECT_ID"
gcloud run jobs describe "$PROD_JOB" --region="$REGION" --project="$PROJECT_ID"
gcloud iam service-accounts create analytics-scheduler --display-name='Analytics ETL production scheduler' --project="$PROJECT_ID"
gcloud run jobs add-iam-policy-binding "$PROD_JOB" --region="$REGION" --project="$PROJECT_ID" --member="serviceAccount:${SCHEDULER_SA}" --role=roles/run.invoker
```

Supply an approved cron and IANA timezone; there is no default. The repository
script is idempotent, creates/updates an OAuth POST to `jobs:run`, and sets zero
retries.

```bash
CRON='<APPROVED_DAILY_CRON>'
TIME_ZONE='<APPROVED_IANA_TIME_ZONE>'
bash scripts/provision-analytics-scheduler.sh --project="$PROJECT_ID" --region="$REGION" --job="$PROD_JOB" --service-account="$SCHEDULER_SA" --cron="$CRON" --time-zone="$TIME_ZONE"
bash scripts/provision-analytics-scheduler.sh --project="$PROJECT_ID" --region="$REGION" --job="$PROD_JOB" --service-account="$SCHEDULER_SA" --cron="$CRON" --time-zone="$TIME_ZONE" --status
```

Pause/resume only by approved decision; required arguments remain mandatory:

```bash
bash scripts/provision-analytics-scheduler.sh --project="$PROJECT_ID" --region="$REGION" --job="$PROD_JOB" --service-account="$SCHEDULER_SA" --cron="$CRON" --time-zone="$TIME_ZONE" --pause
bash scripts/provision-analytics-scheduler.sh --project="$PROJECT_ID" --region="$REGION" --job="$PROD_JOB" --service-account="$SCHEDULER_SA" --cron="$CRON" --time-zone="$TIME_ZONE" --resume
```

Nonprod has no schedule. After approval, execute manually and record approver,
reason, digest/revision, start time, and outcome:

```bash
gcloud run jobs execute "$NONPROD_JOB" --project="$PROJECT_ID" --region="$REGION" --wait
```

## 10. Verification and ownership

- [ ] Owners verified APIs, shared WIF repository condition, AR repository,
      fixed targets, immutable digest promotion, and GitHub protection.
- [ ] Deployers cannot read runtime data; runtime SAs are distinct and scoped
      to their own SQL, secrets, and GCS prefix; Scheduler is invoker-only.
- [ ] Database owner approved read-only roles, measured all eight nonprod query
      plans/read volume, and demonstrated write/DDL/admin denial.
- [ ] Secret versions/access and bucket prefix/no-delete conditions are checked
      without exposing values; consumer access and alerts are approved.
- [ ] Nonprod run verifies socket access, validation, immutable release objects,
      last-object release commit, catalog metadata CAS/source ordering,
      failure isolation, and alerts.
- [ ] Scheduler OAuth target, identity, cron/timezone, zero retries, and a
      completed execution are checked separately before production.
- [ ] Approvals, digest, evidence, rollback, retention, and recovery decisions
      are recorded. These steps do not claim live validation.

CI/CD owns CI gates, amd64 build, AR push, digest resolution/promotion, Cloud
Run Job deployment, and the GitHub production approval gate. Platform,
security, database, analytics, and consumer owners own APIs, WIF, IAM, database
roles, secrets, buckets, alerts, load/SLO, and release approval. Operators own
approved nonprod execution, Scheduler provisioning/pause/resume/status,
evidence, and recovery. Application deployment must not create IAM or schedules;
green CI is not live-state validation.
