FROM python:3.12.13-slim@sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf

COPY --from=ghcr.io/astral-sh/uv:0.11.19@sha256:b46b03ddfcfbf8f547af7e9eaefdf8a39c8cebcba7c98858d3162bd28cf536f6 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    ANALYTICS_ENVIRONMENT=nonprod \
    ANALYTICS_POSTGRES_SOCKET_DIR=/cloudsql/f3data:us-central1:f3data-nonprod \
    ANALYTICS_POSTGRES_USER=preflight \
    ANALYTICS_POSTGRES_DATABASE=f3_staging \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    DUCKDB_EXTENSION_DIR=/opt/duckdb/extensions \
    DUCKDB_POSTGRES_EXTENSION_PATH=/opt/duckdb/extensions/v1.4.3/linux_amd64/postgres_scanner.duckdb_extension

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY packages/db-python ./packages/db-python
COPY apps/slackbot ./apps/slackbot
COPY apps/analytics ./apps/analytics

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --package f3-nation-analytics --no-dev --no-editable

# DuckDB 1.4.3's platform-matched postgres_scanner artifact is installed at
# image build time using DuckDB's signed extension repository. This is more
# reliable than guessing a release artifact's platform identifier. Signature
# verification remains enabled: runtime LOAD validates the installed file.
# linux_amd64 artifact SHA-256: 0cde6a6b625ef16e1b024dac373206a0d3f97bd45533aa7b81b548901f0d2c00
RUN mkdir -p "$DUCKDB_EXTENSION_DIR" && \
    python -c "import duckdb; c=duckdb.connect(':memory:'); c.execute(\"SET extension_directory = '/opt/duckdb/extensions'\"); c.execute('INSTALL postgres'); c.close()" && \
    test -f "$DUCKDB_POSTGRES_EXTENSION_PATH" && \
    echo "0cde6a6b625ef16e1b024dac373206a0d3f97bd45533aa7b81b548901f0d2c00  $DUCKDB_POSTGRES_EXTENSION_PATH" | sha256sum --check --status && \
    chmod 0555 "$DUCKDB_POSTGRES_EXTENSION_PATH"

RUN groupadd --gid 1000 analytics && \
    useradd --uid 1000 --gid analytics --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin analytics && \
    chown -R root:root /app /opt/duckdb/extensions && \
    chmod -R a-w /app /opt/duckdb/extensions

WORKDIR /app/apps/analytics
USER analytics
CMD ["sh", "-c", "ANALYTICS_POSTGRES_PASSWORD=preflight-placeholder exec analytics-etl preflight"]
