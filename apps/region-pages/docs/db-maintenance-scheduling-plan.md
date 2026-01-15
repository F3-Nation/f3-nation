# F3 Region Pages data ingest plan (macOS)

- **Goal**: Run the db prune + seed routines once a day in the background on macOS without manual intervention.
- **Scope**: Use existing package scripts (`pnpm db:prune:regions`, `pnpm db:prune:workouts`, `pnpm db:seed`), no new behavior.

## Assumptions

- Repo lives at `/Users/patrick/src/F3-Nation/f3-region-pages`.
- `pnpm`, `bun`, and the project dependencies are already installed locally.
- Any required env vars for database access are present in `.env.local` (or similar) inside the repo root.

## Approach (recommended: launchd)

- Use the provided shell wrapper to set PATH, load env, cd into the repo, and run the prune/seed commands; logs land in `~/Library/Logs/f3-region-pages-data-ingest/`.
- Register a `LaunchAgent` plist in `~/Library/LaunchAgents` with a daily `StartCalendarInterval`.
- Test by manually starting the job; keep `launchd` disabled/enabled via `launchctl load/unload`.

## Steps to implement

1. **Runner script** (added) `scripts/f3-region-pages-data-ingest.sh`:
   - Sets PATH for Homebrew, loads `.env.local` if present, cds to repo root.
   - Runs `pnpm db:prune:regions`, `pnpm db:prune:workouts`, `pnpm db:seed`.
   - Logs per-run output to timestamped files under `~/Library/Logs/f3-region-pages-data-ingest/`.

2. **LaunchAgent plist template** `docs/launchd/com.f3.dataingest.plist.sample`:
   - Fast path: run `./scripts/install-f3-region-pages-data-ingest.sh` to copy the plist to `~/Library/LaunchAgents/com.f3.dataingest.plist`, rewrite paths for your user, and load it.
   - Manual path: copy to `~/Library/LaunchAgents/com.f3.dataingest.plist`, edit paths (ProgramArguments + WorkingDirectory + StandardOut/Error) if your username or repo path differs, adjust `StartCalendarInterval` Hour/Minute, and set `RunAtLoad` only for testing.

3. **Load and test**
   - Load once: `launchctl load -w ~/Library/LaunchAgents/com.f3.dataingest.plist`.
   - Trigger manually to verify: `launchctl start com.f3.dataingest`.
   - Inspect logs in `~/Library/Logs/f3-region-pages-data-ingest/` for success.
   - If you edit the plist, run `launchctl unload ...` then `launchctl load -w ...` to refresh.

4. **Optional variations**
   - Use `StartInterval` (86400) instead of `StartCalendarInterval` if the exact time does not matter.
   - If you prefer cron: add a crontab entry that runs the same shell script; ensure PATH is set.
   - Add simple log rotation (e.g., delete logs older than N days in the runner script) if desired.

## Safety notes

- Run the runner script manually once before scheduling to confirm env/permissions.
- Keep secrets out of the plist; load them via `.env.local` in the script.
- Ensure only one instance at a time: `launchd` will not overlap runs unless the prior one exceeds a day; add a lockfile in the script if overlapping becomes a risk.
