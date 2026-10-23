---
applyTo: "**/package.json,pnpm-workspace.yaml,turbo.json,renovate.json,knip.config.ts,commitlint.config.mjs,release-please-config.json,.release-please-manifest.json,.nvmrc,**/Dockerfile,docker-compose*.yml,**/env.ts,**/.env*.example,turbo/generators/**"
---

# Dependencies, build, env and release config

## Dependencies

- Every dependency version lives in the root `pnpm-workspace.yaml` catalog; `package.json`
  files use `catalog:` (internal deps use `workspace:*`). Caret ranges are the
  default. Keep lockstep families (`@better-auth/*`, `@orpc/*`) on one range.
- Each package declares every dependency and binary its own scripts import or
  spawn. Don't rely on hoisting.
- Never downgrade a dependency, runtime or tool to satisfy a resolver or a
  reviewer. Upgrade the other side instead.
- Security overrides must cover the advisory's full vulnerable range. List
  the advisory ids in the PR.
- Renovate holds for known-bad versions go in `renovate.json` with a reason.
- Do not flag `minimumReleaseAge: 0` in `pnpm-workspace.yaml`; it is
  intentional, and the `recent-package-watch` CI job covers new releases.
- Scope knip dependency ignores to one workspace. Ambient `@types/*` packages
  stay declared even when knip calls them unused.
- New packages use `AGPL-3.0-or-later`. If `files` is set, it ships every
  entrypoint that `exports` references.

## Version pins move together

- A Node or pnpm bump updates every pin in the same PR: `.nvmrc`, root
  `engines`/`packageManager`, and every Dockerfile (Python pins:
  `python.instructions.md`). Workflows read `.nvmrc`; don't hardcode versions there.
  Grep Dockerfiles for independently pinned tools (`npm i -g`, versioned
  paths, checksums).
- Docker base images use `name:version@sha256:`.
- Major or runtime bumps (Next, React, Tailwind, Node, UI primitives, auth
  libraries) list the upstream behavior changes in the PR, and are checked in
  the shared `packages/ui` primitives and in a built image that actually
  starts. Native modules and file tracing break only in the image.

## Environment variables

Adding, renaming or removing a variable touches all of these in the same PR.
Flag the ones missing.

- The env schema: the app's `src/env.ts` (or `packages/env`).
- `.env.example` (comment what an unset value does) and, when the app has
  one, `.env.cloud-run.example`.
- The app's `scripts/cloud-run-env.sh`.
- The `ci.yml` mock env.
- `turbo.json`:
  - Build-affecting vars go in `globalEnv`.
  - Test-only vars go in that task's `env`.
  - Per-commit values such as `GITHUB_SHA` go only in `globalPassThroughEnv`.
- Docs that list it.

Also:

- Prefer existing config (`F3_CHANNEL`) over a new variable.
- Required production vars fail fast, with no silent `localhost` fallback.
  URL vars use `z.url()`.
- `apps/api` uses `@t3-oss/env-core`: list every var, client and server, in
  `runtimeEnvStrict` (no bundler integration; a missing key fails typecheck).
  Next apps use `@t3-oss/env-nextjs`, where `experimental__runtimeEnv` lists
  only client and shared vars.

## Release and repo registration

- PR titles are Conventional Commits because the squash title drives Release
  Please. Use `fix`/`feat` when a deploy is intended; `chore` and the other
  hidden types don't bump.
- Remove a `release-as` override in the release that consumes it.
- A new app is registered everywhere in the same PR:
  - The `commitlint.config.mjs` scope.
  - `release-please-config.json`, plus the one manual
    `.release-please-manifest.json` entry that `docs/RELEASE_PROCESS.md`
    requires. Don't flag that entry.
  - Its deploy workflow and CI.
  - The local port defaults in `scripts/lib/local-ports.sh`, if it runs
    locally.
  - The issue-form app options and `label-issues-by-app.yml`.
- A new package needs the commitlint scope, and release-please entries only if
  it is versioned and released.
- Removing an app or package cleans the same places.
