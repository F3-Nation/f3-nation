FROM python:3.13.15-slim-bookworm@sha256:00faa2debb87529f9f0764e9491d8ba400a3678976616c3bd7cb193745ac20d1
COPY --from=ghcr.io/astral-sh/uv:0.13.4@sha256:9f130421e930bfbdc563c00740466603f8723158e90297d07957c2294640262b /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    APP_HOME=/app/apps/slackbot \
    GOOGLE_FUNCTION_TARGET=handler

WORKDIR /app

# Create non-root user for security
RUN groupadd --gid 1000 slackbot && \
    useradd --uid 1000 --gid slackbot --shell /bin/bash --create-home slackbot

# Copy source files owned by slackbot (BuildKit --chown is valid on COPY)
COPY --chown=slackbot:slackbot pyproject.toml uv.lock ./
COPY --chown=slackbot:slackbot packages/db-python ./packages/db-python
COPY --chown=slackbot:slackbot apps/analytics/pyproject.toml apps/analytics/README.md ./apps/analytics/
COPY --chown=slackbot:slackbot apps/slackbot ./apps/slackbot

# uv sync runs as root (build-time); fix venv ownership afterward.
# Only /app/.venv needs to be writable by slackbot at runtime.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --package f3-nation-slack-bot --no-dev --no-editable && \
    chown -R slackbot:slackbot /app/.venv

WORKDIR $APP_HOME
USER slackbot
EXPOSE 8080
CMD ["functions-framework", "--target", "handler", "--port", "8080"]
