# Seeded Postgres image for per-PR preview environments (F3-57).
#
# Built by preview-env.yml: the workflow runs drizzle migrations + the
# deterministic local seed (pnpm db:migrate && pnpm db:seed:local) against a
# throwaway Postgres, pg_dumps the result to seed.sql, and bakes it in here.
# The official postgres entrypoint restores it on first boot (PGDATA lives on
# an in-memory emptyDir in Cloud Run, so every cold start is a fresh,
# identical database — that determinism is what the E2E blocking tier needs).
# Pinned to an exact patch for reproducible preview databases; keep in sync
# with the postgres image in .github/workflows/preview-env.yml.
FROM postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636

ENV POSTGRES_USER=f3local \
    POSTGRES_PASSWORD=f3local \
    POSTGRES_DB=f3nation \
    PGDATA=/var/lib/postgresql/data/pgdata

COPY seed.sql /docker-entrypoint-initdb.d/01-seed.sql
