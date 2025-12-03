# F3 Nation Admin (PaxMiner MySQL)

CLI utilities for managing PaxMiner MySQL data that powers the map and other apps. This workspace holds the Drizzle schema, Docker Compose for local MySQL, and scripts to back up production data and reseed a local database.

## Environment

1. Create `.env.production` with `MYSQL_URL` that can read the production PaxMiner database. This is used by backup/pull commands.
2. Create `.env.local` with `MYSQL_URL` for your local MySQL instance (used by migrate/seed/reset). Include `MYSQL_ROOT_PASSWORD` if you change the Docker defaults.
3. You can point a command at a different env file by setting `MYSQL_ENV_FILE=<file>`.

Example `.env.local` that matches the Docker defaults:

```
MYSQL_URL=mysql://f3muletown:local-f3-password@localhost:3307/f3muletown
MYSQL_ROOT_PASSWORD=local-root-password
```

## Local PaxMiner Workflow

- Start MySQL locally (port 3307): `pnpm --filter f3-nation-admin db:up`
- Pull the latest production snapshot into `.data/backups/<timestamp>`: `pnpm --filter f3-nation-admin db:backup`
- Apply the schema to your local DB (creates DB/user if missing): `pnpm --filter f3-nation-admin db:migrate`
- Seed your local DB from the newest backup: `pnpm --filter f3-nation-admin db:seed`
- Do everything in one shot (backup → fresh container → migrate → seed): `pnpm --filter f3-nation-admin db:local:setup`

After seeding, point any app that needs PaxMiner data at the local `MYSQL_URL`.

## Command Reference

- `db:up` / `db:down`: Start/stop the local MySQL container. `db:down` removes the volume, so you get a clean slate the next time you start.
- `db:backup`: Export every table listed in `drizzle/meta/0000_snapshot.json` to `.data/backups/<timestamp>/*.json` using `.env.production`.
- `db:seed`: Load the latest backup into the DB targeted by `.env.local`, normalizing date/datetime/json columns as needed.
- `db:migrate`: Guarded Drizzle push against a local host; also ensures the database/user exist via the root credentials.
- `db:pull`: Refresh the Drizzle snapshot from production so backups and seeds stay in sync with the real schema.
- `db:reset`: Truncate all PaxMiner tables in the target DB; intended for local-only use.
- `migrate:user:posts`: Remap Slack user IDs across PaxMiner tables (with conflict checks). Use `migrate:user:posts:local` or `migrate:user:posts:prod` to target the right environment.

## Backblast Attendance Scripts

Use these to add or remove a single pax’s attendance for a specific AO/date. The scripts guard against missing backblasts and double-entry.

- Add a missing record: `pnpm --filter f3-nation-admin attendance:ensure <slack-user-id> <ao-channel-id> <YYYY-MM-DD>`
- Remove a mistaken record: `pnpm --filter f3-nation-admin attendance:remove <slack-user-id> <ao-channel-id> <YYYY-MM-DD>`
- Target prod/local explicitly with `attendance:ensure:prod` / `attendance:remove:prod` or the `:local` variants; both respect `MYSQL_ENV_FILE`.
- Find Slack user IDs in your workspace’s admin dashboard, e.g. `https://f3muletown.slack.com/admin` (replace `f3muletown` with your region).

## Notes

- Backups/seeds rely on the Drizzle snapshot to know which tables to process. Run `db:pull` when the production schema changes.
- Scripts that mutate data refuse to run against non-local hosts; double-check `MYSQL_URL` before running anything destructive.
- Backup JSON files stay under `.data/backups/` inside this workspace and are gitignored.
