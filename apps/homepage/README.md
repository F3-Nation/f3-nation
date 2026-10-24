# F3 Nation Apps — Homepage

The landing page for the F3 Nation tech ecosystem, served at [apps.f3nation.com](https://apps.f3nation.com).

Provides a directory of all F3 Nation apps with descriptions and links. Built as a static Next.js export deployed to GitHub Pages — no server, no database, no auth.

**Live URL**: [apps.f3nation.com](https://apps.f3nation.com) · **Staging**: [staging.apps.f3nation.com](https://staging.apps.f3nation.com) (see [Staging](#staging))

## Why This Exists

F3 Nation has multiple apps across different domains. This page is the single front door: a human-readable index of what exists, what each app does, and where to find it.

Future routes (e.g. `/status`) can be added without touching the rest of the ecosystem.

## Tech Stack

| Layer     | Choice                                              |
| --------- | --------------------------------------------------- |
| Framework | Next.js 15 (App Router, static export)              |
| Styling   | TailwindCSS (`@acme/tailwind-config/web`)           |
| Hosting   | GitHub Pages (prod); Cloud Run + nginx (staging)    |
| Domain    | `apps.f3nation.com` (CNAME → `f3-nation.github.io`) |
| Node      | 24.x                                                |

## Project Structure

```text
apps/homepage/
├── next.config.ts               # output: "export", trailingSlash, images unoptimized
├── tailwind.config.ts
├── .env.example                 # NEXT_PUBLIC_* build-time vars (see Environment Variables)
├── cloudrun/                    # Staging-only nginx image (Dockerfile, default.conf)
├── public/
│   ├── CNAME                    # Custom domain declaration for GitHub Pages
│   ├── .nojekyll                # Prevents Jekyll from processing the static output
│   ├── favicon.ico
│   └── f3_logo.png
└── src/
    └── app/
        ├── layout.tsx            # Root layout (Inter font, CSS vars)
        ├── globals.css           # Tailwind directives + CSS custom properties
        ├── page.tsx              # Landing page (Next.js App Router entry)
        ├── _lib/                 # App directory data (apps.ts) + build channel (channel.ts)
        └── org/                  # Interactive geographic org directory (see org/README.md)
```

## Local Development

```bash
pnpm dev --filter f3-homepage
```

The app runs at [http://localhost:3005](http://localhost:3005).

The landing page is fully static and needs no configuration. The `/org`
directory route fetches from the API and reads a couple of `NEXT_PUBLIC_*`
variables — see [Environment Variables](#environment-variables). Copy
`.env.example` to `.env` to override the defaults locally.

## Building

```bash
pnpm build --filter f3-homepage
```

Output is written to `apps/homepage/out/`. This is what gets deployed to GitHub Pages.

## Environment Variables

All variables are `NEXT_PUBLIC_*`, so they are **inlined into the static bundle
at build time** (there is no server to read them at runtime) and are visible in
the browser. See [`.env.example`](.env.example).

| Variable                      | Purpose                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_URL`         | Base URL of the API the `/org` route fetches from. Defaults to `https://api.f3nation.com` (`https://staging.api.f3nation.com` when `NEXT_PUBLIC_CHANNEL=staging`). |
| `NEXT_PUBLIC_ORG_MAP_API_KEY` | Read-only Bearer key for the public org-chart endpoints. Grants nothing beyond public directory reads.                                                             |
| `NEXT_PUBLIC_LOCAL_DEV`       | `"true"` redirects app cards to localhost ports and enables `localHref` links.                                                                                     |
| `NEXT_PUBLIC_CHANNEL`         | `"staging"` builds the staging directory (see [Staging](#staging)). Unset or any other value = prod.                                                               |

In CI, `NEXT_PUBLIC_ORG_MAP_API_KEY` is set on the `github-pages` environment
and passed to the build step in [`.github/workflows/deploy-homepage.yml`](../../.github/workflows/deploy-homepage.yml).
Because `NEXT_PUBLIC_ORG_MAP_API_KEY` ships in the client bundle, only ever use
a key scoped to public org-chart reads — never a privileged token.

## Deployment

Deployment is tag-based via Release Please. When a `homepage@*` tag is pushed (e.g. `homepage@0.2.0`), `.github/workflows/deploy-homepage.yml`:

1. Waits for CI to pass
2. Runs `next build` (static export)
3. Uploads `apps/homepage/out/` to GitHub Pages
4. Deploys to `apps.f3nation.com`

The same tag also deploys the staging copy to Cloud Run (see [Staging](#staging)); GitHub Pages itself has a single target, so prod is never previewed there. Review changes carefully before merging a Release Please PR for this app.

### First-time GitHub Pages setup

A one-time repo setting is required before the first deploy:

1. Go to **Settings → Pages** on the `F3-Nation/f3-nation` repo
2. Set **Source** to **GitHub Actions**
3. Set the custom domain to `apps.f3nation.com`

The DNS CNAME record for `apps.f3nation.com` must point to `f3-nation.github.io`.

## Staging

[staging.apps.f3nation.com](https://staging.apps.f3nation.com) is the same
site built with `NEXT_PUBLIC_CHANNEL=staging`:

| Card / call       | Staging target                              |
| ----------------- | ------------------------------------------- |
| F3 Map            | `https://staging.map.f3nation.com`          |
| F3 Me             | `https://staging.me.f3nation.com`           |
| Admin             | `https://staging.admin.f3nation.com`        |
| API (card + base) | `https://staging.api.f3nation.com`          |
| Org Chart         | `https://staging.apps.f3nation.com/org`     |
| Status            | `https://staging.apps.f3nation.com/status/` |

Linked apps without a `stagingHref` in `src/app/_lib/apps.ts` (PAX Vault, The
Codex, Region Pages, F3 Near Me, Slack Bot, SyncBot) are **hidden** so testers
never land on production. Informational cards (Auth) stay. The `/org` and
`/status` pages call the staging API unless `NEXT_PUBLIC_API_URL` overrides it.

Build it locally. Clear `NEXT_PUBLIC_LOCAL_DEV` and `NEXT_PUBLIC_API_URL` too:
a `.env` created by local setup sets them, and they would point the cards and
the API at localhost instead of staging.

```bash
NEXT_PUBLIC_CHANNEL=staging NEXT_PUBLIC_LOCAL_DEV= NEXT_PUBLIC_API_URL= \
  pnpm build --filter f3-homepage
```

### Staging deploy

[`.github/workflows/deploy-homepage-staging.yml`](../../.github/workflows/deploy-homepage-staging.yml)
runs on the same `homepage@*` tag push as the prod Pages deploy (or by
`workflow_dispatch` with an existing tag). It waits for CI, builds the staging
export, checks it links no production host, packages `out/` into the nginx
image in [`cloudrun/`](cloudrun/), pushes it to Artifact Registry and deploys
Cloud Run service `f3-homepage` in project `f3-map-app-staging`
(`us-central1`). It authenticates with the existing `map-staging` GitHub
environment's `WIF_PROVIDER` / `WIF_SA`, so it needs no new credentials.

### One-time setup (run by a Cloud Run admin)

Run once before the first staging deploy. Steps 1–2 are `gcloud`, 3 is DNS,
and 4–5 are GitHub.

```bash
GCP_STAGING_PROJECT="f3-map-app-staging"
GCP_REGION="us-central1"
CLOUDRUN_SERVICE="f3-homepage"
STAGING_DOMAIN="staging.apps.f3nation.com"
```

1. **Create the service** with a public placeholder (the workflow replaces
   the image on its first run; `--allow-unauthenticated` is only set here):

   ```bash
   gcloud run deploy "$CLOUDRUN_SERVICE" \
     --image=us-docker.pkg.dev/cloudrun/container/hello \
     --region="$GCP_REGION" \
     --project="$GCP_STAGING_PROJECT" \
     --allow-unauthenticated \
     --max-instances=2
   ```

2. **Map the domain**. Domain mappings need the caller to be a verified
   owner of `f3nation.com` in Search Console (true for whoever mapped
   `staging.map.f3nation.com`; otherwise run
   `gcloud domains verify f3nation.com` first):

   ```bash
   gcloud beta run domain-mappings create \
     --service="$CLOUDRUN_SERVICE" \
     --domain="$STAGING_DOMAIN" \
     --region="$GCP_REGION" \
     --project="$GCP_STAGING_PROJECT"

   # Shows the DNS record to create and, later, certificate status
   gcloud beta run domain-mappings describe \
     --domain="$STAGING_DOMAIN" \
     --region="$GCP_REGION" \
     --project="$GCP_STAGING_PROJECT"
   ```

3. **Create the DNS record** at the `f3nation.com` DNS host:
   `staging.apps` **CNAME** `ghs.googlehosted.com.` (use the exact record
   `describe` prints). The managed certificate is issued after DNS resolves,
   usually within 15–60 minutes. This does not touch the `apps` CNAME to
   `f3-nation.github.io` that serves prod.

4. **GitHub environment `map-staging`** (Settings → Environments):
   - add variable `HOMEPAGE_ORG_MAP_API_KEY` = a read-only org-chart API key
     valid on the **staging** API (as `NEXT_PUBLIC_ORG_MAP_API_KEY` on
     `github-pages` is for prod). The staging deploy fails without it, so
     `/org` is never shipped unauthenticated;
   - if the environment restricts deployment branches/tags, allow
     `homepage@*` alongside `map@*`.

5. **Deploy**: run **Deploy Homepage (Staging)** from the Actions tab with the
   latest `homepage@x.y.z` tag, or wait for the next release.

## Adding Content

### Adding a new app to the landing page

Edit the `APP_GROUPS` array in `src/app/_lib/apps.ts`. Each group has:

```ts
{
  title: "Group Name",        // rendered as an <h2> section heading
  description: "Who it's for.",
  apps: [
    {
      name: "New App Name",
      description: "What it does.",
      href: "https://newapp.f3nation.com",
      // optional: only shown in local dev (NEXT_PUBLIC_LOCAL_DEV=true)
      localHref: "http://localhost:3000",
      // optional: the staging build links here instead; without it the
      // app is hidden from staging.apps.f3nation.com
      stagingHref: "https://staging.newapp.f3nation.com",
      // optional: override the default "Open" link label
      linkLabel: "Learn More",
    },
  ],
}
```

Apps belong to one of three groups: **Everyday Use**, **Region Admins**, or **Developers**.

### Adding a new route

Create a new directory under `src/app/`. Because the site uses `output: "export"`, every page must be fully static — no `getServerSideProps`, no API routes, no dynamic segments without `generateStaticParams`.

It is recommended that you add a dedicated README.md into the new directory.
