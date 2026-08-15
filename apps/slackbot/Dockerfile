FROM python:3.13.15-slim-bookworm@sha256:00faa2debb87529f9f0764e9491d8ba400a3678976616c3bd7cb193745ac20d1
COPY --from=ghcr.io/astral-sh/uv:0.12.4@sha256:d0a6eca6c669dc7e9c51218707b8438a3d30402733d739dcc00adb3e213e8f5c /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    APP_HOME=/app/apps/slackbot \
    GOOGLE_FUNCTION_TARGET=handler

WORKDIR /app

# Create non-root user for security (must exist before uv sync so --chown works)
RUN groupadd --gid 1000 slackbot && \
    useradd --uid 1000 --gid slackbot --shell /bin/bash --create-home slackbot

COPY pyproject.toml uv.lock ./
COPY packages/db-python ./packages/db-python
COPY apps/slackbot ./apps/slackbot

# Run uv sync as slackbot so the venv is created with correct ownership;
# no post-install chown -R needed, avoiding metadata rewrites on the venv tree.
RUN --mount=type=cache,target=/root/.cache/uv \
    --chown=slackbot:slackbot \
    uv sync --locked --package f3-nation-slack-bot --no-dev --no-editable

WORKDIR $APP_HOME
USER slackbot
EXPOSE 8080
CMD ["functions-framework", "--target", "handler", "--port", "8080"]
