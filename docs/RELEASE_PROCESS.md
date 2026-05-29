# Release Process

This document describes how code merged to `dev` becomes a tagged release and triggers a production deployment.

---

## Overview

```
feature branch → PR → dev
                         ↓
                  Release Please runs
                         ↓
               release PR opened/updated
               (version bump + CHANGELOG)
                         ↓
                  you merge the PR
                         ↓
              Release Please creates a tag
              (e.g. me@1.2.0, admin@1.1.0)
                         ↓
              deploy-me.yml / deploy-admin.yml
              / deploy-auth.yml fires on that tag
                         ↓
                app is deployed to staging
                         ↓
                Admin manually approves Action
                         ↓
                app is deployed to prod
```

---

## Step-by-Step

### 1. Develop and merge feature PRs normally

Write commits using [Conventional Commits](https://www.conventionalcommits.org/) — this is already enforced by commitlint. The commit type determines how the version is bumped:

| Commit type                                                 | Version bump                   |
| ----------------------------------------------------------- | ------------------------------ |
| `fix(me): ...`                                              | patch — `1.1.0` → `1.1.1`      |
| `feat(me): ...`                                             | minor — `1.1.0` → `1.2.0`      |
| `feat(me)!: ...` or `BREAKING CHANGE:` footer               | major — `1.1.0` → `2.0.0`      |
| `chore`, `docs`, `test`, `ci`, `style`, `build`, `refactor` | no bump, hidden from changelog |

Release Please attributes a commit to a component based on **which files were changed**, not the commit scope. The scope is informational only. A commit is included in `apps/me`'s changelog only if at least one file under `apps/me/` was modified.

This matters for shared packages: a `fix(api): ...` commit that only touches `packages/api/` will not appear in `apps/me`'s changelog and will not bump its version. To get a shared package change to trigger an app release, you must also touch a file in the app's directory — typically bumping the workspace dependency version in `apps/me/package.json` — in the same commit or a follow-up commit.

### 2. Release Please opens a PR automatically

After a push to `dev`, the `release-please.yml` workflow runs. It:

- Scans commits to `dev` since the last release for each app
- Determines the appropriate semver bump per app
- Opens (or updates) a PR titled something like `chore(main): release me 1.2.0` that:
  - Bumps the version in `apps/me/package.json`
  - Generates/updates `apps/me/CHANGELOG.md`

If multiple PRs are merged to `dev` before the Release Please PR is merged, Release Please accumulates all of them — the PR is updated in place, never duplicated.

### 3. Review and merge the Release Please PR

The PR is purely mechanical (version + changelog). Review the changelog entries to make sure they're accurate. When ready, merge it into `dev`.

### 4. Release Please creates the tag

On merge of the Release Please PR, the workflow runs again and this time creates the tag (e.g. `me@1.2.0`). This is why the GitHub App token is required — see the [GitHub App section](#github-app) below.

### 5. Deploy workflow fires

The tag triggers the corresponding deploy workflow:

| Tag pattern | Workflow                             | Environments                           |
| ----------- | ------------------------------------ | -------------------------------------- |
| `me@*`      | `.github/workflows/deploy-me.yml`    | `me-staging` → `me.f3nation.com`       |
| `admin@*`   | `.github/workflows/deploy-admin.yml` | `admin-staging` → `admin.f3nation.com` |
| `auth@*`    | `.github/workflows/deploy-auth.yml`  | `auth-staging` → `auth.f3nation.com`   |

Each deploy workflow:

1. Waits for CI checks to pass on the tagged commit
2. Builds the Docker image and pushes to GCP Artifact Registry
3. Deploys to the staging Cloud Run service
4. Promotes the image and deploys to production

---

## Changelog Format

Only these commit types appear in the generated `CHANGELOG.md`:

- **Features** — `feat`
- **Bug Fixes** — `fix`
- **Performance Improvements** — `perf`
- **Reverts** — `revert`

Breaking changes appear in a dedicated **⚠ BREAKING CHANGES** section regardless of type. Each entry links to the originating commit SHA.

The changelogs live alongside each app's source and can be referenced during release PR review.

---

## Configuration Files

| File                                   | Purpose                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `.github/workflows/release-please.yml` | Runs on push to `dev`; creates/updates release PRs and tags                           |
| `release-please-config.json`           | Defines which packages are tracked, tag format, changelog sections                    |
| `.release-please-manifest.json`        | Tracks the last-released version of each app; updated automatically by Release Please |

**Do not manually edit `.release-please-manifest.json`.** Release Please owns this file.

---

## Adding a New App to Release Please

1. Add an entry to the `packages` object in `release-please-config.json`
2. Add the current version to `.release-please-manifest.json`
3. Make sure the deploy workflow for that app triggers on the correct tag pattern (e.g. `newapp@*`)
4. Add `newapp` to the `scope-enum` array in `commitlint.config.mjs`

---

<details>
<summary><strong>GitHub App — why it exists, how it's set up, and where the secrets are</strong></summary>

### Why a GitHub App is required

GitHub has a security rule: **workflows triggered by `GITHUB_TOKEN` cannot themselves trigger other workflows.** This prevents infinite loops, but it also means that if Release Please used `GITHUB_TOKEN` to create a tag like `me@1.2.0`, the `deploy-me.yml` workflow (which triggers on `me@*` tags) would never fire. The release would be silently created with no deployment.

A **GitHub App** token is not subject to this restriction. Tags and commits pushed with a GitHub App's token do trigger downstream workflows normally.

A PAT (Personal Access Token) would also work technically, but PATs are tied to an individual GitHub account. If that person leaves the org, the token stops working and deployments break silently. A GitHub App is owned by the **F3-Nation organization** and is not tied to any individual contributor.

### How the GitHub App is set up

The app is configured at the organization level:

1. **Created at**: `github.com/organizations/F3-Nation/settings/apps`
2. **Name**: `f3-nation-release-please` (or similar)
3. **Webhooks**: disabled (not needed)
4. **Repository permissions granted**:
   - Contents: Read & Write (to create commits, tags, and update files)
   - Pull requests: Read & Write (to open and update release PRs)
   - Issues: Read & Write (for edge cases in release tracking)
5. **Installed on**: the `F3-Nation/f3-nation` repository only

During each workflow run, `actions/create-github-app-token@v1` exchanges the App ID and private key for a **short-lived installation token** that expires when the workflow ends. No long-lived credential is ever used at runtime.

### Where the secrets are stored

Two repository secrets are set at **Settings → Secrets and variables → Actions** on the `F3-Nation/f3-nation` repo:

| Secret name                      | Value                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| `RELEASE_PLEASE_APP_ID`          | The numeric App ID shown on the GitHub App's settings page            |
| `RELEASE_PLEASE_APP_PRIVATE_KEY` | The full PEM-encoded private key generated on the App's settings page |

To rotate the private key: generate a new key on the GitHub App settings page, update the `RELEASE_PLEASE_APP_PRIVATE_KEY` secret, then delete the old key from the App. No code changes are needed.

To view or manage the App: any F3-Nation org admin can go to `github.com/organizations/F3-Nation/settings/apps`.

</details>
