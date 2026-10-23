---
applyTo: "**/*.sh,scripts/**,tooling/scripts/**,apps/*/scripts/**,.agents/skills/**/scripts/**"
---

# Shell scripts and operator CLIs

These are developer- and operator-run tools, not app runtime code.

- `console.*` output and direct `process.env` reads are expected here. Do not
  ask for `@acme/logger` or `@acme/env`.
- Portable bash for macOS (bash 3.2) and WSL:
  - Start with `#!/usr/bin/env bash`.
  - No `declare -A`, `readlink -f`, `mapfile`, or GNU-only flags.
  - Guard empty arrays and `$2` under `set -u`.
  - Invoke child scripts with `"$BASH"`.
- Fail loudly:
  - Exit non-zero on any real failure.
  - `|| true` is only for best-effort teardown (`kill`, `wait`, cleanup).
  - Distinguish NOT_FOUND from other errors.
  - Never print secrets, DB URLs or row values.
- Install an `EXIT` trap between claiming a resource and recording it, so
  Ctrl-C can't leak containers, slots, worktrees or temp files.
- Create temp files with `mktemp` (mode 700 dirs). Never use fixed `/tmp`
  paths.
- Before `shift 2`, check that a flag's value exists. Resolve user-supplied
  relative paths against the caller's directory (`INIT_CWD`), not the package
  directory.
- Local-dev scripts are slot-aware: derive ports and container names from
  `F3_*_PORT` / `F3_CONTAINER_PREFIX`, or use `docker compose exec <service>`.
  Unset inherited `DATABASE_*` / `EMAIL_*` before sourcing a sandbox env,
  because `dotenv` never overrides existing vars.
- Every new helper under `scripts/` or a skill's `scripts/` ships a paired
  `*.test.sh`, wired into `scripts/lint.sh`. A test fails, rather than skips,
  when a required tool is missing in CI.
  - A hand-run, top-to-bottom operator script may skip tests if the PR says
    why.
- Cloud Run env helpers (`cloud-run-env*.sh`):
  - `--update-env-vars` never removes keys; pass unset optional vars to
    `--remove-env-vars`.
  - Join values with a custom delimiter (`^|^`) and reject values containing
    it.
  - Build and validate the whole argument before pushing any secret or IAM
    binding.
  - Never rotate or destroy a secret another service shares.
  - Check that both channel variables match `--env`.
