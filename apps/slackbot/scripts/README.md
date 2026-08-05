# Scripts Module

This directory contains the scripts and automation jobs for the F3 Nation Slack Bot project. These scripts are designed to be run as a Cloud Run Job or manually for scheduled or batch operations (such as hourly reporting, reminders, and data updates).

## Structure

- `Dockerfile` — builds the scripts container image with uv and the Slackbot `scripts` dependency group (matplotlib, pandas, playwright + Chromium); dev tooling is excluded via `--no-dev`
- `hourly_runner.py` — Entrypoint for running all hourly scripts
- Other Python scripts for specific automation tasks

## How to Build the Scripts Image

Deployment happens through GitHub Actions tag releases in [`.github/workflows/deploy-slackbot.yml`](../../../.github/workflows/deploy-slackbot.yml) — pushing a `slackbot@*` tag builds and deploys both the bot service and this scripts job. The manual build below is for local testing or a one-off push.

1. **Navigate to the repository root:**

   ```sh
   cd ../../..
   ```

2. **Build the Docker image:**

   ```sh
   docker build \
     --platform=linux/amd64 \
     --file apps/slackbot/scripts/Dockerfile \
     --tag us-central1-docker.pkg.dev/<PROJECT>/<REPO>/<IMAGE>:<TAG> \
     .
   ```

   - Replace `<PROJECT>`, `<REPO>`, `<IMAGE>`, and `<TAG>` with your GCP project, Artifact Registry repo, image name, and tag.
   - `--platform=linux/amd64` is required: Cloud Run only runs amd64, and the Dockerfile no longer pins the platform on its `FROM` lines. Without it, an Apple Silicon machine builds an arm64 image that Cloud Run rejects at deploy time.
   - With the GitHub Actions flow, the scripts image is published as `us-central1-docker.pkg.dev/<PROJECT>/<REPO>/f3-slackbot-scripts:<TAG>`.

## How to Run Locally

1. **Install dependencies:**
   ```sh
   uv sync --package f3-nation-slack-bot --group dev
   ```
2. **Run the hourly runner:**

   ```sh
   uv run --package f3-nation-slack-bot python -m scripts.hourly_runner
   ```

   - You can pass arguments like `--force` or `--skip-reporting` as needed.

## How It Works

- The main entrypoint is `hourly_runner.py`, which coordinates the execution of all scheduled scripts.
- Each script is responsible for a specific automation task (e.g., reminders, reporting, Slack updates).
- The Dockerfile ensures all system and Python dependencies are available for headless browser and data processing tasks.

## Notes

- This image is intended for Cloud Run Jobs and includes heavy dependencies not needed by the main app.
- The main app image uses the default dependency set only; this scripts image adds the `scripts` group for Playwright, pandas, and reporting tools.
