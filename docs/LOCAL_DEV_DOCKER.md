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

## Prerequisites

Install these before starting:

| Tool                       | Install                                                                               | Check            |
| -------------------------- | ------------------------------------------------------------------------------------- | ---------------- |
| **Docker Desktop**         | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | `docker version` |
| **Node.js** (see `.nvmrc`) | `nvm install`                                                                         | `node -v`        |
| **pnpm** v10+              | `corepack enable && corepack prepare pnpm@latest --activate`                          | `pnpm -v`        |
| **Git**                    | [git-scm.com](https://git-scm.com)                                                    | `git --version`  |

Make sure Docker Desktop is **running** before you continue.

## Detailed Prerequites Install Instructions

<details>
<summary>WSL: Coding on a Windows machine</summary>

In order to properly develop for the repo, you'll need to develop against Linux, not Windows. You can do this by installing Windows Subsystem for Linux (WSL). Think of it as a virtual Linux server on your Windows machine. You can connect to it and from there use git to interact with GitHub and your favorite IDE to develop.

1. Open PowerShell as an admin and run the following command to enable the WSL features and download an Ubuntu (a version of Linux) 'distro' (your virtual Linux environment). It will ask you for a default username and password. Don't forget those.

```bash
wsl --install
```

<img width="713" height="225" alt="image" src="https://github.com/user-attachments/assets/7597a8aa-214e-4b8d-b701-cdf8b0a5be2c" />

2. Run the command below to check that it's installed correctly. You should see Name = `Ubuntu` and Version = `2`. Version 2 means you have WSL2. This is important you're on WSL2.

```bash
wsl.exe --list --verbose
```

<img width="464" height="56" alt="image" src="https://github.com/user-attachments/assets/ef199882-f2ec-4596-ad0f-e025cf847b41" />

3. Open Linux. Go to your start menu and search for 'Ubuntu'. Select it. This will open a command prompt.

<img width="797" height="798" alt="image" src="https://github.com/user-attachments/assets/49976145-4994-42ba-99c2-ebc4b04d1ebf" />

<img width="784" height="484" alt="image" src="https://github.com/user-attachments/assets/8b0254ee-abbc-4802-b930-ea4c2aebfc55" />

You can interact with files in WSL via File Explorer. It should show up near where you see This PC. You'll go to Linux, then select the distro 'Ubuntu', then drill down to `home` > your username. This folder will be your base of operations. When you open Ubuntu from the Start menu, it defaults you to here.

<img width="847" height="462" alt="image" src="https://github.com/user-attachments/assets/784a79d5-85ea-44e3-925f-b0c295e76b7c" />

_You'll need git. Based on testing, git comes pre-installed with Ubuntu. If not, please update these instructions with how you installed it._

</details>

<details>
<summary>Docker for WSL: Skip the need for Docker Desktop </summary>

Running Docker Engine natively in WSL is lighter and often more reliable than Docker Desktop's WSL integration. These steps assume Ubuntu — adjust package commands for other distros.

### 1. Add Docker's apt repository

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

### 2. Install Docker Engine

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 3. Add your user to the `docker` group

```bash
sudo usermod -aG docker $USER
# if the group doesn't exist yet: sudo addgroup docker
```

### 4. Test

Close and re-open your terminal, then:

```bash
docker run hello-world
```

</details>

<details>
<summary>git: Saving and submitting code; working with GitHub</summary>
git is how you interact with GitHub from your instance of the code. You often already have git. If not, here's a link.

1. Go to https://git-scm.com/install/ and download the correct version. During install, if you don't know what anything means, just leave defaults and keep hitting Next.
</details>

<details>
<summary>VS Code: User interface work coding</summary>
You will need a code editor in order to edit code! The instructions assume you will be using VS Code. If you have a different IDE, you'll have to adjust accordingly.

1. Go to https://code.visualstudio.com/download and download the correct version.
</details>

<details>
<summary>NVM: Node Version Manager</Summary>
The monorepo is based on Node.js. NVM allows you to install and manage versions of Node on your machine. You will need it installed in order to run the apps.

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

After install, close and reopen your terminal.

</details>

## Set Up

### 1. Clone and install dependencies

> If you are on Windows, it is recommended you use WSL (Windows Subsystem for Linux) to run local development.

The following commands will set up the base environment. If any commands fail, look above for more detailed setup.

```bash
git clone https://github.com/F3-Nation/f3-nation.git
cd f3-nation
nvm install        # installs the Node version in .nvmrc
pnpm install
```

### 2. Run the one-time setup script

```bash
pnpm local:setup
```

This script does everything automatically:

- Copies each directory's `.env.example` → `.env` (skips any that already exist):
  `apps/api`, `apps/auth`, `apps/homepage`, `apps/map`, `apps/me`, `apps/admin`, and `packages/env`
- Starts the four Docker containers
- Waits for Postgres to be ready
- Creates the `f3-public-images` bucket in the GCS emulator
- Runs all database migrations
- Seeds the database with sample F3 org data

You should see output ending with:

```text
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
2. Create a project and enable **Maps JavaScript API** and **Places API (New)**
3. Create an API key
4. Set the key in both `apps/map/.env` and `apps/api/.env`:
   `NEXT_PUBLIC_GOOGLE_API_KEY=your-key-here`

> **Troubleshooting AuthFailure:** If the map shows an "AuthFailure" error after adding your key, the API key likely has HTTP referrer restrictions that block `localhost`. In the Google Cloud Console, set **Application restrictions** to **None** (or add `http://localhost:3000/*` as an allowed HTTP referrer) for local development.

### 4. (Optional) Open Code in VSCode or other IDE

Instead of interating with code via terminal, you can use an IDE like Visual Studio Code.

```bash
code .
```

The above command will install code if you don't have it already and then open you workspace in it.

### 5. Start the app servers

```bash
pnpm dev
```

| App      | URL                   |
| -------- | --------------------- |
| Map      | http://localhost:3000 |
| API      | http://localhost:3001 |
| Admin    | http://localhost:3002 |
| Me       | http://localhost:3003 |
| Auth     | http://localhost:3004 |
| Homepage | http://localhost:3005 |

---

## Set Up

### 1. Clone and install dependencies

> If you are on Windows, it is recommended you use WSL (Windows Subsystem for Linux) to run local development.

The following commands will set up the base environment. If any commands fail, look below for more detailed setup.

```bash
git clone git@github.com:F3-Nation/f3-nation.git
cd f3-nation
nvm install        # installs the Node version in .nvmrc
pnpm install
```

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

## Understanding the .env files

Each app and shared package has its own `.env` file, copied from a `.env.example` template during `pnpm local:setup`. All template values work out-of-the-box with Docker — you don't need to edit anything to get started.

| Directory           | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `apps/api/.env`     | API app (Next.js on port 3001)                                     |
| `apps/auth/.env`    | Auth app (Next.js on port 3004)                                    |
| `apps/map/.env`     | Map app (Next.js on port 3000)                                     |
| `apps/admin/.env`   | Admin app (Next.js on port 3002)                                   |
| `apps/me/.env`      | Me app (Next.js on port 3003)                                      |
| `packages/env/.env` | Shared backend env root (used by `packages/db` and `packages/api`) |

Here's what each variable means:

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

| Variable                   | Value                    | Meaning                                                                 |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `EMAIL_SERVER`             | `smtp://localhost:1025`  | Points to Mailpit's SMTP port                                           |
| `EMAIL_FROM`               | `noreply@f3nation.local` | Sender address shown in Mailpit                                         |
| `EMAIL_ADMIN_DESTINATIONS` | `admin@f3nation.local`   | Admin notification recipients (visible in Mailpit)                      |
| `EMAIL_REGION_IN_A_BOX_CC` | _(unset)_                | Optional CC list (comma-separated) for "region in a box" welcome emails |

### Google Cloud Storage (GCS emulator)

| Variable            | Value                                      | Meaning                                                             |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `GCS_EMULATOR_HOST` | `localhost:9023`                           | Tells the app to use the local emulator instead of real GCS         |
| `GCS_CREDENTIALS`   | `local-placeholder-not-used-with-emulator` | Required by env validation, but **ignored** when emulator is active |
| `F3_CHANNEL`        | `local`                                    | Selects staging bucket (`f3-public-images-staging`) for local dev   |

When `GCS_EMULATOR_HOST` is set, the upload route skips Google authentication entirely and sends files directly to the local fake-gcs-server. Uploaded logos are stored in a Docker volume at canonical paths such as `org-logos/{orgId}.jpg` and served at `http://localhost:9023/f3-public-images-staging/<path>`.

### Client-side URLs

These tell each Next.js app where to find the other apps. Don't change these unless you're running on non-default ports.

| Variable                | Value                   |
| ----------------------- | ----------------------- |
| `NEXT_PUBLIC_API_URL`   | `http://localhost:3001` |
| `NEXT_PUBLIC_MAP_URL`   | `http://localhost:3000` |
| `NEXT_PUBLIC_ADMIN_URL` | `http://localhost:3002` |
| `NEXT_PUBLIC_AUTH_URL`  | `http://localhost:3004` |
| `NEXT_PUBLIC_CHANNEL`   | `local`                 |

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
- Three dev users: `dev-admin@f3local.dev`, `dev-editor@f3local.dev`, and `dev-user@f3local.dev`
- Standard event types (Bootcamp, Run, Ruck, etc.)
- OAuth clients for the Me app (`f3-me-local`) and the Admin app (`f3-admin-local`)

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
3. The emulator stores the file in the `f3-public-images-staging` bucket (local `F3_CHANNEL`)
4. The returned public URL points to `http://localhost:9023/f3-public-images-staging/org-logos/<orgId>.jpg`

### Browsing stored files

To list all uploaded files in the emulator:

```bash
curl http://localhost:9023/storage/v1/b/f3-public-images/o | jq '.items[].name'
```

Individual files are directly accessible at `http://localhost:9023/f3-public-images/<filename>`.

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
  -d '{"name": "f3-public-images"}'
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

### WSL - Ports in use or 'could not translate host name

If you're using WSL, know that different instances of WSL can affect each other. This pertains to docker, docker network, and ports. If you have docker running on one WSL distribution, it could prevent it working here. If you've already stood up the system and are in a weird state follow these steps.

1. Launch all other instances of WSL you have and shutdown docker with

```bash
sudo systemctl stop docker.socket docker.service
```

2. Restart docker in the Nation monorepo distro (this won't affect any existing data)

```bash
docker compose -f docker-compose.yml down --remove-orphans
sudo systemctl restart docker
pnpm local:setup
```

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
  -d '{"name": "f3-public-images"}'
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

Make sure each app's `.env` file exists and has all required variables.
Re-run the setup script — it skips directories that already have a `.env`:

```bash
pnpm local:setup
```

Or manually re-copy an individual app:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/map/.env.example apps/map/.env
# etc.
```

Then add `NEXT_PUBLIC_GOOGLE_API_KEY` to `apps/map/.env` and `apps/api/.env` if you have one.
