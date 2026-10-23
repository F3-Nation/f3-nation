---
applyTo: "**/package.json,pnpm-workspace.yaml,turbo.json,renovate.json,knip.config.ts,commitlint.config.mjs,release-please-config.json,.release-please-manifest.json,.nvmrc,**/Dockerfile,docker-compose*.yml,**/env.ts,**/.env*.example,turbo/generators/**"
---

# Dependencies, build, env and release config

## Dependencies

- Every version lives in the root `pnpm-workspace.yaml` catalog, and
  `package.json` files use `catalog:`. Caret ranges are the default. Keep
  lockstep families on one range.
- Internal deps use `workspace:*`.
- Each package declares every dependency and binary its own scripts import or
  spawn. Don't rely on hoisting.
- Never downgrade a dependency, runtime or tool to satisfy a resolver or a
  reviewer. Upgrade the other side instead.
- Security overrides must cover the advisory's full vulnerable range. List
  the advisory ids in the PR.
- Renovate holds for known-bad versions go in `renovate.json` with a reason.
- Scope knip ignores to one workspace, not globally. Ambient `@types/*`
  packages stay declared even when knip calls them unused.
- New packages use the `AGPL-3.0-or-later` license. Their `files` field ships
  every entrypoint that `exports` references.

## Version pins move together

- A Node, pnpm or Python bump updates every pin in the same PR: `.nvmrc`,
  `engines`/`packageManager`, every app Dockerfile, workflows and the setup
  action. Grep Dockerfiles for independently pinned tools (`npm i -g`,
  versioned paths, checksums).
- Docker base images use `name:version@sha256:`.
- Major or runtime bumps (Next, React, Tailwind, Node, UI primitives, auth
  libraries) list the upstream behavior changes in the PR, and are checked in
  the shared `packages/ui` primitives and in a built image that actually
  starts. Native modules and file tracing break only in the image.

## Environment variables

Adding, renaming or removing a variable touches all of these in the same PR.
Flag the ones missing.

- The app's `src/env.ts` schema.
- `.env.example` (comment what an unset value does) and
  `.env.cloud-run.example`.
- `scripts/cloud-run-env*.sh`.
- The `ci.yml` mock env.
- `turbo.json`:
  - Build-affecting vars go in `globalEnv`.
  - Test-only vars go in that task's `env`.
  - Per-commit values such as `GITHUB_SHA` go only in `globalPassThroughEnv`.
- Docs that list it.

Also:

- Prefer existing config (`F3_CHANNEL`) over a new variable.
- Required production vars fail fast, with no silent `localhost` fallback.
  URL vars use `z.string().url()`.
- Use `runtimeEnvStrict` with `@t3-oss/env-core`.

## Release and repo registration

- PR titles are Conventional Commits because the squash title drives Release
  Please. Use `fix`/`feat` when a deploy is intended, not `perf`/`chore`.
- Release Please attributes commits by the files they change, not by scope.
- Remove a `release-as` override in the release that consumes it.
- A new app or package is registered everywhere in the same PR:
  - The `commitlint.config.mjs` scope.
  - `release-please-config.json`, plus the one manual
    `.release-please-manifest.json` entry that `docs/RELEASE_PROCESS.md`
    requires. Don't flag that entry.
  - CI and deploy workflows.
  - The local port defaults in `scripts/lib/local-ports.sh`.
  - `CODEOWNERS` and the issue labels.
- Removing an app cleans the same places.
