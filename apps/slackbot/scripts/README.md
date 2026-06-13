# Scripts Module

This directory contains the scripts and automation jobs for the F3 Nation Slack Bot project. These scripts are designed to be run as a Cloud Run Job or manually for scheduled or batch operations (such as hourly reporting, reminders, and data updates).

## Structure

- `Dockerfile` — Dockerfile for building the scripts container image (includes all heavy dependencies)
- `requirements.txt` — Python dependencies for scripts (can include plotting, Playwright, pandas, etc.)
- `hourly_runner.py` — Entrypoint for running all hourly scripts
- Other Python scripts for specific automation tasks

## How to Build the Scripts Image

Primary deployment now happens through GitHub Actions tag releases in [`.github/workflows/deploy-slackbot.yml`](../../../.github/workflows/deploy-slackbot.yml). The Cloud Build config is retained only as a temporary migration path.

1. **Navigate to this directory:**

   ```sh
   cd scripts
   ```

2. **Build the Docker image:**

   ```sh
   gcloud builds submit --tag us-central1-docker.pkg.dev/<PROJECT>/<REPO>/<IMAGE>:<TAG> .
   ```

   - Replace `<PROJECT>`, `<REPO>`, `<IMAGE>`, and `<TAG>` with your GCP project, Artifact Registry repo, image name, and tag.
   - With the GitHub Actions flow, the scripts image is published as `us-central1-docker.pkg.dev/<PROJECT>/<REPO>/f3-slackbot-scripts:<TAG>`.

## How to Run Locally

1. **Install dependencies:**
   ```sh
   pip install -r requirements.txt
   ```
2. **Run the hourly runner:**

   ```sh
   python -m scripts.hourly_runner
   ```

   - You can pass arguments like `--force` or `--skip-reporting` as needed.

## How It Works

- The main entrypoint is `hourly_runner.py`, which coordinates the execution of all scheduled scripts.
- Each script is responsible for a specific automation task (e.g., reminders, reporting, Slack updates).
- The Dockerfile ensures all system and Python dependencies are available for headless browser and data processing tasks.

## Notes

- This image is intended for Cloud Run Jobs and includes heavy dependencies not needed by the main app.
- Keep the main app's Dockerfile and requirements.txt in the project root for a slim deployment.
