# Release Process

This document describes how code merged to `main` becomes a tagged release and triggers a production deployment.

---

## Overview

```
feature branch → PR → main
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
              / deploy-auth.yml / deploy-slackbot.yml fires on that tag
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

After a push to `main`, the `release-please.yml` workflow runs. It:

- Scans commits to `main` since the last release for each app
- Determines the appropriate semver bump per app
- Opens (or updates) a PR titled something like `chore(main): release me 1.2.0` that:
  - Bumps the version in `apps/me/package.json`
  - Generates/updates `apps/me/CHANGELOG.md`

After Release Please opens or updates a release PR, the same workflow runs
`uv lock` on the PR branch in a job without secrets, then a second job commits
any `uv.lock` change to the PR with the GitHub App token. This keeps Docker's
`uv sync --locked ...` build step aligned with Release Please's version bump
to `apps/slackbot/pyproject.toml`.

If multiple PRs are merged to `main` before the Release Please PR is merged, Release Please accumulates all of them — the PR is updated in place, never duplicated.

### 3. Review and merge the Release Please PR

The PR is purely mechanical (version + changelog). Review the changelog entries to make sure they're accurate. When ready, merge it into `main`.

When the release PR merges, [`release-please.yml`](../.github/workflows/release-please.yml) starts [`release-plan.yml`](../.github/workflows/release-plan.yml), which runs the [`release`](../.agents/skills/release/SKILL.md) skill unattended with Claude Code. It files the Staging release plan and, when the release ships an app, the Staging test plan, linked to each other. The plans can appear before the Staging deploys finish, so the release plan's first step checks that they succeeded. A run that ends without those plans, linked, fails and comments on the release PR with a link to it. Run **Release Plan** again from the Actions page: it plans only the latest merged release PR, never refiles a plan that release already has, and files a missing release plan or link. It doesn't file a test plan for a release plan that already exists; have an agent run the skill for that. After the Staging go/no-go, have an agent run the same skill for the Production release plan; nothing files that one automatically. The skill works only from a merged release PR, never an open one, which is only a running changelog.

The workflow runs in the `release-plan` environment, which accepts runs from `main` alone. It authenticates to the Claude API with [workload identity federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation): the job exchanges its GitHub OIDC token for a short-lived token that acts as a Claude Console service account, and the repository stores no Claude credential. The federation rule, service account and workspace are set up on the Console's [Workload identity](https://platform.claude.com/settings/workload-identity-federation) page, and their IDs are inputs in `release-plan.yml`. The rule accepts only the subject `repo:F3-Nation/f3-nation:environment:release-plan`, so only a run in that environment, and therefore only from `main`, gets a token; renaming the repository or the environment means updating that subject in the Console. The service account belongs to a workspace with a spend limit that nothing else uses, so the limit caps only this workflow. When a run can't authenticate, the Console's authentication history shows the rejected exchange and its reason. What the run may do is set in [`release-plan.yml`](../.github/workflows/release-plan.yml): its `--allowedTools` list and each job's `permissions:`.

### 4. Release Please creates the tag

On merge of the Release Please PR, the workflow runs again and this time creates the tag (e.g. `me@1.2.0`). This is why the GitHub App token is required — see the [GitHub App section](#github-app) below.

### 5. Deploy workflow fires

The tag triggers the corresponding deploy workflow:

| Tag pattern  | Workflow                                | Environments                               |
| ------------ | --------------------------------------- | ------------------------------------------ |
| `me@*`       | `.github/workflows/deploy-me.yml`       | `me-staging` → `me.f3nation.com`           |
| `admin@*`    | `.github/workflows/deploy-admin.yml`    | `admin-staging` → `admin.f3nation.com`     |
| `auth@*`     | `.github/workflows/deploy-auth.yml`     | `auth-staging` → `auth.f3nation.com`       |
| `slackbot@*` | `.github/workflows/deploy-slackbot.yml` | `slackbot-staging` → `slackbot-production` |

Each deploy workflow:

1. Waits for CI checks to pass on the tagged commit
2. Builds the Docker image and pushes to GCP Artifact Registry
3. Deploys to the staging Cloud Run service
4. Promotes the image and deploys to production

For `slackbot@*`, the workflow runs two deploy tracks from one tag:

1. Main Slackbot Cloud Run service deploy (`f3-slackbot` in `f3-slackbot-staging` and `f3-slackbot`)
2. Scripts Cloud Run Job deploy (`f3-slackbot-scripts` in `f3-slackbot-staging` and `f3-slackbot`)

The [Homepage workflow](../.github/workflows/deploy-homepage.yml) publishes
directly to GitHub Pages. Its emitted check names must stay distinct from the CI
checks its gate waits on; see
[Deploy pipeline (per app)](CI_PIPELINE.md#deploy-pipeline-per-app).

#### Overlapping deploys

Each deploy job is serialized by its **target**, not by its release tag. The
reusable workflows (`_deploy-cloudrun.yml`, `_deploy-cloudrun-job.yml`) put
`deploy-staging` and `deploy-prod` in a concurrency group named after the GCP
project, region, and Cloud Run service or job, with `cancel-in-progress: false`.
So two tags for the same app (for example a release and a manual re-deploy of
an older tag) can never deploy the same service at the same time, while
unrelated services, and `f3-auth` and `f3-auth3`, still deploy in parallel.

What this does not guarantee:

- **Newest wins.** Serialization stops overlap, not regressions: an older tag
  dispatched after a newer one still deploys last. Re-dispatch the newer tag
  to fix it.
- **Every queued run.** A group holds one running job and at most one pending
  job. A third run arriving while one is pending replaces it, and the replaced
  run shows as cancelled. A production job waiting for approval may hold its
  group until it is approved or rejected.

The workflow-level `concurrency` in each Cloud Run `deploy-*.yml` caller is
still keyed by tag; it only stops the same tag from building twice at once.

The [Homepage workflow](../.github/workflows/deploy-homepage.yml) is the
exception: it has no reusable deploy job, and its workflow-level group is the
fixed name `deploy-homepage` rather than one keyed by tag. Every release tag
publishes the same GitHub Pages site, so all Homepage runs, for any tag,
queue in one group with `cancel-in-progress: false`. The two limits above
apply to it as well.

#### Who can release and approve

A release tag is what ships code, so these protections keep a production
deploy behind reviewed code and a second person:

- **Release tags.** The `release-tags` tag ruleset limits who can create, move
  or delete release tags to the release automation and org admins;
  [`scripts/release-protections.sh`](../scripts/release-protections.sh) sets
  the exact pattern and bypass list. A writer can't tag an unreviewed commit
  and trigger a deploy workflow.
- **Release PR branch.** The `release-branches` ruleset limits who can create,
  push to or delete Release Please's `release-please--*` branches to the
  release automation and org admins. The release workflow runs `uv lock` on
  that branch, which can run the branch's build backends, so it must hold only
  Release Please's own output. To change a release PR, change `main`; Release
  Please rebuilds the PR on the next push.
- **Release app key.** The Release Please app's private key is stored only in
  the `release-please` environment, which accepts runs from `main` alone, so a
  workflow on another branch can't read it and tag through the app.
- **Tag on `main`.** Each deploy's CI gate fails unless the tag points at a
  commit already on `main`, including a `workflow_dispatch` re-deploy. The
  gate runs before staging, so a tag cut from an unmerged branch can't deploy,
  even to staging.
- **Production environments.** Each `*-production` environment accepts deploys
  only from its app's release tags (`api@*` for `api-production`) or `main`,
  where `workflow_dispatch` re-deploys run. Admins can't bypass it, and a
  required reviewer can't approve a deploy they started, so give each one at
  least two reviewers.

The ruleset and environment settings live in GitHub.
[`scripts/release-protections.sh`](../scripts/release-protections.sh) checks
them and exits non-zero on drift; a repo admin runs it with `--apply` to set
them, keeping each environment's reviewers. `--apply` can't move a secret, so
an admin moves the app key into the `release-please` environment by hand. It
also stops with an error, before touching the production environments, if the
`release-please` environment has required reviewers or a wait timer; an admin
removes them and re-runs it. When you add a production environment, add it to
the script's `PROD_ENVIRONMENTS` list too; its test fails while the list and
the deploy workflows' `prod_environment` inputs disagree.

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

| File                                   | Purpose                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `.github/workflows/release-please.yml` | Runs on push to `main`; creates/updates release PRs and tags                                        |
| `.github/workflows/release-plan.yml`   | Started by `release-please.yml` when a release is cut; files the Staging test plan and release plan |
| `release-please-config.json`           | Defines which packages are tracked, tag format, changelog sections                                  |
| `.release-please-manifest.json`        | Tracks the last-released version of each app; updated automatically by Release Please               |

**Do not manually edit `.release-please-manifest.json`.** Release Please owns this file.

---

## Adding a New App to Release Please

1. Add an entry to the `packages` object in `release-please-config.json`
2. Add the current version to `.release-please-manifest.json`
3. Make sure the deploy workflow for that app triggers on the correct tag pattern (e.g. `newapp@*`)
4. Add `newapp` to the `scope-enum` array in `commitlint.config.mjs`
5. Add it to CI, the local port defaults in `scripts/lib/local-ports.sh` (if it runs locally), and the issue-form app options and `label-issues-by-app.yml`

Removing an app cleans up the same places. A new package needs only the commitlint scope, plus release-please entries if it is versioned and released. Remove a `release-as` override in the release that consumes it, and use `fix`/`feat` when a change should deploy: `chore` and the other hidden types don't bump a version.

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

Two secrets are set in the `release-please` environment at **Settings → Environments → release-please** on the `F3-Nation/f3-nation` repo. The private key lives only there: repository and organization secrets can be read by a workflow on any branch, which could then tag an unreviewed commit through the app.

| Secret name                      | Value                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| `RELEASE_PLEASE_APP_ID`          | The numeric App ID shown on the GitHub App's settings page            |
| `RELEASE_PLEASE_APP_PRIVATE_KEY` | The full PEM-encoded private key generated on the App's settings page |

To rotate the private key: generate a new key on the GitHub App settings page, update the `RELEASE_PLEASE_APP_PRIVATE_KEY` secret in the `release-please` environment, then delete the old key from the App. No code changes are needed.

To view or manage the App: any F3-Nation org admin can go to `github.com/organizations/F3-Nation/settings/apps`.

</details>
