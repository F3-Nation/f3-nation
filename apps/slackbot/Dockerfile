FROM python:3.13.15-slim-bookworm@sha256:0f16c5d35fe6464ee471792ab3bb9116f911b65b3fbf10120c98d2bdc6332f48

COPY --from=ghcr.io/astral-sh/uv:0.12.4@sha256:0ff11fbfed5cb87a930fa471748f03bd78cbc15a4fc09f18b06a15e0ead32370 /uv /uvx /bin/

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
