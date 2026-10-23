---
applyTo: "**/*.sh,scripts/**,tooling/scripts/**,apps/*/scripts/**,.agents/skills/**/scripts/**"
---

# Shell scripts and operator CLIs

Developer/operator tools, not app runtime. Exceptions that ARE runtime:
`apps/slackbot/scripts/*.py` (Cloud Run Job code) and
`apps/slackbot/app_startup.sh`; the exemption below does not apply to them.

- In JS/TS operator CLIs, `console.*` and direct `process.env` reads are
  expected. Do not ask for `@acme/logger` or `@acme/env`.
- Bash:
  - Start with `#!/usr/bin/env bash`.
  - Local-dev scripts (`scripts/`) must run on macOS bash 3.2 and WSL: no
    `declare -A`, `readlink -f`, `mapfile`, or GNU-only flags. Guard empty
    arrays and `$2` under `set -u`.
  - `cloud-run-env*.sh` helpers and their tests require bash 4+ (documented
    in `docs/LOCAL_DEV_DOCKER.md`) and may use associative arrays.
  - Tests that restrict `PATH` invoke the script under test with `"$BASH"`.
- Fail loudly:
  - Exit non-zero on any real failure.
  - `|| true` only for best-effort teardown (`kill`, `wait`, cleanup).
  - Distinguish NOT_FOUND from other errors; don't fall back on an
    unrecognized failure.
  - Never print secrets, DB URLs or row values.
- Install an `EXIT` trap before claiming a resource, or between claiming and
  recording it, so Ctrl-C can't leak containers, slots, worktrees or temp
  files.
- Use `mktemp`, never fixed `/tmp` paths.
- Before `shift 2`, check that the flag's value exists.
- Resolve user-supplied relative paths against the caller's directory, not
  the package's. `pnpm` runs scripts from the package directory and a nested
  `pnpm` resets `INIT_CWD`, so capture `$INIT_CWD` in the package.json
  script.
- Local-dev scripts are slot-aware: derive ports and container names from
  `F3_*_PORT` / `F3_CONTAINER_PREFIX` (see `scripts/lib/local-ports.sh`), or
  use `docker compose exec <service>`. Never hard-code `f3-postgres` or
  `:5433`.
- Before sourcing an env file, unset inherited vars it is meant to supply:
  `dotenv` and `source` don't override what the shell already exports.
- A new helper with branching logic ships a paired `*.test.sh` wired into
  `scripts/lint.sh`. The test fails, not skips, when a required tool is
  missing in CI. (Cloud Run env helpers may instead be tested from the app's
  vitest/pytest suite.)
- Cloud Run env helpers (`apps/*/scripts/cloud-run-env*.sh`):
  - `--update-env-vars` never removes keys: pass unset optional vars to
    `--remove-env-vars`.
  - Join values with gcloud's custom `^DELIM^` syntax (a comma breaks values
    like `EMAIL_FROM` or `SLACK_SCOPES`) and fail if a value contains the
    delimiter. Reuse `join_env_vars` in `apps/auth/scripts/lib`.
  - Build and validate the whole argument before pushing any secret or IAM
    binding.
  - Never rotate or destroy a secret another service shares.
  - If the env file sets `F3_CHANNEL` / `NEXT_PUBLIC_CHANNEL`, require each
    to equal `--env` before any cloud call.
