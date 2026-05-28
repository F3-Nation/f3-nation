# F3 Nation Apps — Homepage

The landing page for the F3 Nation tech ecosystem, served at [apps.f3nation.com](https://apps.f3nation.com).

Provides a directory of all F3 Nation apps with descriptions and links. Built as a static Next.js export deployed to GitHub Pages — no server, no database, no auth.

**Live URL**: [apps.f3nation.com](https://apps.f3nation.com)

## Why This Exists

F3 Nation has multiple apps across different domains. This page is the single front door: a human-readable index of what exists, what each app does, and where to find it.

Future routes (e.g. `/status`) can be added without touching the rest of the ecosystem.

## Tech Stack

| Layer     | Choice                                              |
| --------- | --------------------------------------------------- |
| Framework | Next.js 15 (App Router, static export)              |
| Styling   | TailwindCSS (`@acme/tailwind-config/web`)           |
| Hosting   | GitHub Pages (via GitHub Actions)                   |
| Domain    | `apps.f3nation.com` (CNAME → `f3-nation.github.io`) |
| Node      | 24.x                                                |

## Project Structure

```text
apps/homepage/
├── next.config.ts               # output: "export", trailingSlash, images unoptimized
├── tailwind.config.ts
├── public/
│   ├── CNAME                    # Custom domain declaration for GitHub Pages
│   ├── .nojekyll                # Prevents Jekyll from processing the static output
│   ├── favicon.ico
│   └── f3_logo.png
└── src/
    └── app/
        ├── layout.tsx            # Root layout (Inter font, CSS vars)
        ├── globals.css           # Tailwind directives + CSS custom properties
        └── page.tsx              # Landing page — app directory
```

## Local Development

```bash
pnpm dev --filter f3-homepage
```

The app runs at [http://localhost:3005](http://localhost:3005).

No environment variables are required — the app is fully static.

## Building

```bash
pnpm build --filter f3-homepage
```

Output is written to `apps/homepage/out/`. This is what gets deployed to GitHub Pages.

## Deployment

Deployment is tag-based via Release Please. When a `homepage@*` tag is pushed (e.g. `homepage@0.2.0`), `.github/workflows/deploy-homepage.yml`:

1. Waits for CI to pass
2. Runs `next build` (static export)
3. Uploads `apps/homepage/out/` to GitHub Pages
4. Deploys to `apps.f3nation.com`

No staging environment — GitHub Pages has one deployment target. Review changes carefully before merging a Release Please PR for this app.

### First-time GitHub Pages setup

A one-time repo setting is required before the first deploy:

1. Go to **Settings → Pages** on the `F3-Nation/f3-nation` repo
2. Set **Source** to **GitHub Actions**
3. Set the custom domain to `apps.f3nation.com`

The DNS CNAME record for `apps.f3nation.com` must point to `f3-nation.github.io`.

## Adding Content

### Adding a new app to the landing page

Edit the `APPS` array in `src/app/page.tsx`:

```ts
{
  name: "New App Name",
  description: "What it does.",
  href: "https://newapp.f3nation.com",
  // optional: override the default "Open" link label
  linkLabel: "Learn More",
}
```

### Adding a new route

Create a new directory under `src/app/`. Because the site uses `output: "export"`, every page must be fully static — no `getServerSideProps`, no API routes, no dynamic segments without `generateStaticParams`.
