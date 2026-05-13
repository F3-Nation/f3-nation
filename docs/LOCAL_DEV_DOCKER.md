# Local Docker Development Setup

This guide walks through setting up a **fully local** F3 Nation development environment using Docker. You do **not** need any Google Cloud credentials to follow this guide.

> **Recommended path for new contributors.** If you already have GCP access, see [LOCAL_DEV_SETUP.md](LOCAL_DEV_SETUP.md) instead.

---

## What you're setting up

Four Docker containers replace the cloud services you'd otherwise need access to:

| Container        | What it is                                       | Local URL             |
| ---------------- | ------------------------------------------------ | --------------------- |
| **Postgres**     | The app's database, pre-loaded with seed data    | `localhost:5433`      |
| **Adminer**      | A web UI to browse and query the database        | http://localhost:8080 |
| **GCS Emulator** | Emulates Google Cloud Storage for logo uploads   | http://localhost:9023 |
| **Mailpit**      | Catches all outbound emails so you can read them | http://localhost:8025 |

Your app servers (Map, API, Auth) still run natively on your machine with `pnpm dev`. Docker only manages the stateful infrastructure.

---

## Prerequisites

Install these before starting:

| Tool                       | Install                                                                               | Check            |
| -------------------------- | ------------------------------------------------------------------------------------- | ---------------- |
| **Docker Desktop**         | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | `docker version` |
| **Node.js** (see `.nvmrc`) | `nvm install`                                                                         | `node -v`        |
| **pnpm** v10+              | `corepack enable && corepack prepare pnpm@latest --activate`                          | `pnpm -v`        |
| **Git**                    | [git-scm.com](https://git-scm.com)                                                    | `git --version`  |

Make sure Docker Desktop is **running** before you continue.

---

## Quick start

### 1. Clone and install dependencies

```bash
git clone git@github.com:F3-Nation/f3-nation.git
cd f3-nation
nvm install        # installs the Node version in .nvmrc
pnpm install
```

### 2. Run the one-time setup script

```bash
pnpm local:setup
```

This script does everything automatically:

- Copies `.env.docker.example` → `.env` (skips if `.env` already exists)
- Starts the four Docker containers
- Waits for Postgres to be ready
- Creates the `f3-logos` bucket in the GCS emulator
- Runs all database migrations
- Seeds the database with sample F3 org data

You should see output ending with:

```
  ✓ Setup complete!

  Services running:
    Postgres  → localhost:5433
    Adminer   → http://localhost:8080  (user: f3local / pass: f3local)
    GCS       → http://localhost:9023
    Mailpit   → http://localhost:8025  (all outbound emails land here)
```

### 3. (Optional) Add a Google Maps API key

The app will start without this, but the map tiles won't render. To get one:

1. Go to [console.cloud.google.com/google/maps-apis](https://console.cloud.google.com/google/maps-apis/)
2. Create a project and enable **Maps JavaScript API**
3. Create an API key
4. Open `.env` and set: `NEXT_PUBLIC_GOOGLE_API_KEY=your-key-here`

### 4. Start the app servers

```bash
pnpm dev
```

| App  | URL                   |
| ---- | --------------------- |
| Map  | http://localhost:3000 |
| API  | http://localhost:3001 |
| Auth | http://localhost:3004 |

---

## Daily workflow

After the one-time setup is done, your daily commands are:

```bash
pnpm docker:up        # start Docker services in the background (detached)
pnpm docker:up:logs   # start Docker services and stream their logs to the terminal
pnpm docker:down      # stop Docker services
pnpm dev              # start app servers (in a separate terminal)
```

Use `docker:up` for normal day-to-day use — containers run in the background and you get your terminal back. Use `docker:up:logs` when you need to watch container output in real time, such as debugging a Postgres startup issue or monitoring GCS emulator traffic.

The Docker containers save their data in named volumes (`postgres_data`, `gcs_data`), so your data persists between restarts.

---

## Understanding the .env file

The `.env` file at the repo root controls how the app connects to local services. `.env.docker.example` contains values that work out-of-the-box with Docker. Here's what each variable means:

### Database

| Variable            | Value                                                       | Meaning                                 |
| ------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`      | `postgresql://f3local:f3local@localhost:5433/f3nation`      | Connection string for the main database |
| `TEST_DATABASE_URL` | `postgresql://f3local:f3local@localhost:5433/f3nation_test` | Connection string for the test database |

The `5433` port is where the Docker Postgres container is exposed on your machine. Inside Docker, Postgres uses its default port (`5432`), but it's mapped to `5433` to avoid conflicts with any Postgres you might have installed locally.

### Auth & API keys

| Variable              | Value                   | Meaning                                               |
| --------------------- | ----------------------- | ----------------------------------------------------- |
| `AUTH_SECRET`         | (any long string)       | Signs authentication tokens. Any value works locally. |
| `API_KEY`             | `local-api-key`         | Identifies internal API-to-API requests.              |
| `SUPER_ADMIN_API_KEY` | `local-super-admin-key` | Admin-level API access key.                           |

### Email (Mailpit)

All outbound emails are captured by [Mailpit](https://mailpit.axllent.org/) — no emails actually leave your machine. Open http://localhost:8025 to read any email the app sends (password resets, notifications, etc.).

| Variable                   | Value                    | Meaning                                            |
| -------------------------- | ------------------------ | -------------------------------------------------- |
| `EMAIL_SERVER`             | `smtp://localhost:1025`  | Points to Mailpit's SMTP port                      |
| `EMAIL_FROM`               | `noreply@f3nation.local` | Sender address shown in Mailpit                    |
| `EMAIL_ADMIN_DESTINATIONS` | `admin@f3nation.local`   | Admin notification recipients (visible in Mailpit) |

### Google Cloud Storage (GCS emulator)

| Variable                          | Value                   | Meaning                                                             |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `GCS_EMULATOR_HOST`               | `localhost:9023`        | Tells the app to use the local emulator instead of real GCS         |
| `GOOGLE_LOGO_BUCKET_PRIVATE_KEY`  | `local-placeholder-...` | Required by env validation, but **ignored** when emulator is active |
| `GOOGLE_LOGO_BUCKET_CLIENT_EMAIL` | `local@local.local`     | Same — ignored when emulator is active                              |
| `GOOGLE_LOGO_BUCKET_BUCKET_NAME`  | `f3-logos`              | The bucket name used by both the emulator and real GCS              |

When `GCS_EMULATOR_HOST` is set, the upload route skips Google authentication entirely and sends files directly to the local fake-gcs-server. Uploaded logos are stored in a Docker volume and served at `http://localhost:9023/f3-logos/<filename>`.

### Client-side URLs

These tell each Next.js app where to find the other apps. Don't change these unless you're running on non-default ports.

| Variable               | Value                   |
| ---------------------- | ----------------------- |
| `NEXT_PUBLIC_API_URL`  | `http://localhost:3001` |
| `NEXT_PUBLIC_MAP_URL`  | `http://localhost:3000` |
| `NEXT_PUBLIC_AUTH_URL` | `http://localhost:3004` |
| `NEXT_PUBLIC_CHANNEL`  | `local`                 |

### Google Maps

| Variable                     | Value      | Meaning                                                                      |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | (your key) | Google Maps JavaScript API key. App starts without it, but the map is blank. |

---

## Database management

### Browse the database with Adminer

1. Open http://localhost:8080
2. Fill in the login form:
   - **System**: PostgreSQL
   - **Server**: `f3-postgres`
   - **Username**: `f3local`
   - **Password**: `f3local`
   - **Database**: `f3nation`
3. Click **Login**

You can run SQL queries, browse tables, and edit data from here.

### Useful database commands

```bash
pnpm db:migrate       # apply any pending migrations
pnpm db:studio        # open Drizzle Studio (interactive schema browser)
pnpm db:seed:local    # re-run the local seed (safe to run multiple times)
pnpm db:reset         # DANGER: wipe and recreate the database
```

### Adding your own seed data

The seed script lives at [packages/db/src/local-seed.ts](../packages/db/src/local-seed.ts). It creates:

- An F3 Nation org hierarchy (nation → sectors → areas → regions → AOs)
- Locations with coordinates centered around Charlotte, NC and Boone, NC
- Two dev users: `dev-admin@f3local.dev` and `dev-editor@f3local.dev`
- Standard event types (Bootcamp, Run, Ruck, etc.)

To add more data:

1. Open `packages/db/src/local-seed.ts`
2. Add entries to the `REGIONS`, `AOS`, or `DEV_USERS` arrays at the top of the file
3. Run `pnpm db:seed:local` to apply your additions

All inserts use `onConflictDoNothing()`, so re-running the seed won't duplicate existing data.

---

## GCS emulator

Logo uploads in the Map app are handled by the GCS emulator (`fake-gcs-server`) running at `http://localhost:9023`.

### How it works

1. When you upload a logo, the Map app sends the image to its `/api/upload-logo` route
2. The route detects `GCS_EMULATOR_HOST` in the env and calls the emulator instead of real GCS
3. The emulator stores the file in the `f3-logos` bucket
4. The returned public URL points to `http://localhost:9023/f3-logos/<filename>`

### Resetting uploaded files

To delete all uploaded logos:

```bash
pnpm docker:down -v        # stop containers AND destroy volumes
pnpm local:setup           # restart and re-initialize
```

Or, to keep other data but clear just the GCS volume:

```bash
docker volume rm f3-local_gcs_data
pnpm docker:up
# then re-create the bucket:
curl -X POST http://localhost:9023/storage/v1/b \
  -H "Content-Type: application/json" \
  -d '{"name": "f3-logos"}'
```

---

## Stopping and resetting

### Stop services (keep data)

```bash
pnpm docker:down
```

This stops the containers but keeps the Docker volumes. Your database and uploaded files will still be there when you run `pnpm docker:up` again.

### Stop services and delete all data

```bash
docker compose -f docker-compose.yml down -v
```

The `-v` flag removes the named volumes (`postgres_data`, `gcs_data`). Next time you run `pnpm local:setup`, it will start fresh.

---

## Troubleshooting

### Port already in use

If you see an error like `port is already allocated`, another process is using that port.

```bash
# Find what's using port 5433:
lsof -ti:5433

# Kill it:
lsof -ti:5433 | xargs kill

# Or, if Cloud SQL Auth Proxy is running as a service, stop it:
launchctl unload ~/Library/LaunchAgents/com.google.cloud-sql-proxy.plist   # macOS
systemctl --user stop cloud-sql-proxy                                        # Linux
```

The same pattern works for ports 8080 and 9023.

### Postgres won't start

Check the container logs:

```bash
docker logs f3-postgres
```

If the logs show a data directory error, try removing the volume and starting fresh:

```bash
docker compose -f docker-compose.yml down -v
pnpm local:setup
```

### GCS bucket not found (404 on logo upload)

The bucket needs to be created after the emulator starts. Run:

```bash
curl -X POST http://localhost:9023/storage/v1/b \
  -H "Content-Type: application/json" \
  -d '{"name": "f3-logos"}'
```

### Migrations failing

Make sure Docker is running and Postgres is healthy:

```bash
docker ps                     # should show f3-postgres, f3-adminer, f3-gcs
docker exec f3-postgres pg_isready -U f3local   # should print "accepting connections"
pnpm db:migrate
```

If migrations fail with a schema error, try resetting the database:

```bash
pnpm db:reset       # wipes and recreates tables
pnpm db:migrate     # re-applies all migrations
pnpm db:seed:local  # re-seeds data
```

### `relation "..." does not exist`

You have pending migrations. Run:

```bash
pnpm db:migrate
```

### App fails to start with env validation errors

Make sure `.env` exists and has all required variables. Re-copy from the template:

```bash
cp .env.docker.example .env
```

Then edit `.env` to add `NEXT_PUBLIC_GOOGLE_API_KEY` if you have one.
