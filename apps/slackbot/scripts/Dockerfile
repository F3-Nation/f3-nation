FROM --platform=linux/amd64 python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    APP_HOME=/app/apps/slackbot

WORKDIR /app

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    gnupg \
    libglib2.0-0 \
    libgdk-pixbuf-2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libexpat1 \
    libdbus-1-3 \
    libx11-xcb1 \
    libxext6 \
    libxfixes3 \
    libxcb1 \
    libsm6 \
    libxtst6 \
    fonts-liberation \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
COPY packages/db-python ./packages/db-python
COPY apps/slackbot ./apps/slackbot

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --package f3-nation-slack-bot --group scripts --no-dev --no-editable

WORKDIR $APP_HOME
RUN python -m playwright install chromium

CMD ["python", "-m", "scripts.hourly_runner"]
