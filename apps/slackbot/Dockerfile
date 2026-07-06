FROM --platform=linux/amd64 python:3.14-slim@sha256:b877e50bd90de10af8d82c57a022fc2e0dc731c5320d762a27986facfc3355c1

COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    APP_HOME=/app/apps/slackbot \
    GOOGLE_FUNCTION_TARGET=handler

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY packages/db-python ./packages/db-python
COPY apps/slackbot ./apps/slackbot

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --package f3-nation-slack-bot --no-dev --no-editable

WORKDIR $APP_HOME
EXPOSE 8080
CMD ["functions-framework", "--target", "handler", "--port", "8080"]
