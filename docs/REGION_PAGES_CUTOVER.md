# Region Pages Cutover and Neon Retirement

Move `regions.f3nation.com` from the legacy app (repo `f3-nation/f3-region-pages`, GCP project `region-pages`) to the monorepo app (`apps/region-pages`, GCP project `f3-region-pages-app`, live today at `regions2.f3nation.com`), then retire the legacy Neon database (about 26 USD/mo) after a 14 day soak.

Nothing in this runbook deletes anything until the final, signoff-gated teardown section.

- Executor: release lead (Tackle, @taterhead247). The domain mapping lives in `f3-region-pages-app`.
- Monitor: @BigGillyStyle.
- Background: #1355 (app migration), #1436 (staging release plan), #1365 (API rate limit), #1488 (prod URL).

![Current and proposed data path](region-pages-cutover.svg)

## Why this is safe

- The new app reads F3 data from Cloud SQL `f3data` through `apps/api`; it has no Neon dependency.
- Region slugs match exactly: 573 on the legacy site and 573 in the regions2 sitemap, both from lodash `kebabCase(name)`.
- The legacy service, its Neon database, and its secrets stay untouched through the soak, so rollback is a domain mapping move.

## Pre-checks

- [ ] #1436 staging soak and prod go/no-go are checked.
- [ ] `curl -fsS https://regions2.f3nation.com/health` succeeds.
- [ ] #1365 rate limit headroom is acceptable for a cold crawl after the canonical change.
- [ ] A release containing the regions2 redirect (`apps/region-pages/src/proxy.ts`) is deployed to prod. It is inert until `SITE_URL` changes.
- [ ] Neon backup is less than 7 days old (else take a fresh `pg_dump -Fc`).
- [ ] Record the current state:
  - `gcloud beta run domain-mappings list --project region-pages --region us-central1`
  - `gcloud run services describe f3-region-pages --project f3-region-pages-app --region us-central1`

## Cutover (low traffic window)

1. Pause the legacy ingest. Find the caller of `POST /api/ingest` on the legacy service (Cloud Scheduler is disabled in `region-pages`, so check other projects, GitHub Actions, and local launchd jobs) and disable it. Then save the current `CRON_SECRET` in 1Password and rotate it so any unknown caller gets 401:

   ```sh
   gcloud run services update f3-region-pages --project region-pages \
     --region us-central1 --update-env-vars CRON_SECRET=<new random value>
   ```

2. Release the domain from the legacy project (the service keeps running):

   ```sh
   gcloud beta run domain-mappings delete --domain regions.f3nation.com \
     --project region-pages --region us-central1
   ```

3. Map it to the monorepo app. DNS already points at `ghs.googlehosted.com`; expect a short gap while the managed certificate issues.

   ```sh
   gcloud beta run domain-mappings create --service f3-region-pages \
     --domain regions.f3nation.com --project f3-region-pages-app --region us-central1
   gcloud beta run domain-mappings describe --domain regions.f3nation.com \
     --project f3-region-pages-app --region us-central1
   ```

4. Point canonicals at the real domain, which also activates the regions2 301:

   ```sh
   gcloud run services update f3-region-pages --project f3-region-pages-app \
     --region us-central1 --update-env-vars SITE_URL=https://regions.f3nation.com
   ```

   Update the same value wherever the deploy workflow reads it, so the next release does not revert it.

## Verification

- [ ] `curl -sS https://regions.f3nation.com/ | grep -o '<link rel="canonical"[^>]*>'` names regions.f3nation.com.
- [ ] Every `<loc>` in `https://regions.f3nation.com/sitemap.xml` is on regions.f3nation.com and the region count is 573.
- [ ] Three sample region slugs and one event page return 200.
- [ ] `curl -sI 'https://regions2.f3nation.com/<slug>?letter=a'` returns 301 to `https://regions.f3nation.com/<slug>?letter=a`.
- [ ] `f3region.info` still lands on regions.f3nation.com.
- [ ] Legacy `/api/ingest` with the old secret returns 401.

## 14 day soak

Watch Cloud Run errors and API 429s daily. Leave Neon, the legacy service, and `staging.f3regions.com` (still mapped to the legacy service) running.

## Rollback (any time during the soak)

1. `gcloud beta run domain-mappings delete --domain regions.f3nation.com --project f3-region-pages-app --region us-central1`
2. `gcloud beta run domain-mappings create --service f3-region-pages --domain regions.f3nation.com --project region-pages --region us-central1`
3. `gcloud run services update f3-region-pages --project f3-region-pages-app --region us-central1 --update-env-vars SITE_URL=https://regions2.f3nation.com` (the 301 turns itself off).
4. Restore the saved `CRON_SECRET`, re-enable the ingest caller, and run one ingest to catch Neon up.

## Teardown (later, separate, needs explicit signoff)

Only after day 14 and signoff from the release lead:

1. Move or retire `staging.f3regions.com` (it depends on Neon).
2. Take a final Neon dump.
3. Delete the Neon project `hidden-queen-01752643`.
4. Delete the legacy Cloud Run service and its secrets; consider retiring the `region-pages` GCP project.
