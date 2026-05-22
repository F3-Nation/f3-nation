# syntax=docker/dockerfile:1.7
#
# Monorepo-aware multi-stage build for the F3 region-pages Next.js app, targeting
# Cloud Run. Build CONTEXT is the MONOREPO ROOT (not this app dir):
#
#   DOCKER_BUILDKIT=1 docker build -f apps/region-pages/Dockerfile \
#     --platform linux/amd64 --provenance=false \
#     --secret id=postgres_url,src=./.secrets/postgres_url \
#     --secret id=warehouse_url,src=./.secrets/warehouse_url \
#     -t <region>-docker.pkg.dev/<project>/<repo>/web:<tag> .
#
# `next build` runs generateStaticParams() against the database, so the build
# needs POSTGRES_URL (Neon). F3_DATA_WAREHOUSE_URL is passed too for parity with
# the standalone build; both are BuildKit secrets, never baked into a layer.

FROM --platform=linux/amd64 node:24-alpine AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app
RUN npm install -g turbo@^1.12.3
COPY . .
# Prune the workspace to just region-pages + its dependencies
RUN turbo prune f3-region-pages --docker

FROM --platform=linux/amd64 node:24-alpine AS installer
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV CI=true
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Install deps from the pruned lockfile (pnpm version from root packageManager).
# --ignore-scripts: skip the app's dev-only lifecycle scripts during prod build.
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --ignore-scripts

# Pull in the full pruned source and build region-pages.
COPY --from=builder /app/out/full/ .
RUN --mount=type=secret,id=postgres_url \
    --mount=type=secret,id=warehouse_url \
    POSTGRES_URL="$(cat /run/secrets/postgres_url 2>/dev/null)" \
    F3_DATA_WAREHOUSE_URL="$(cat /run/secrets/warehouse_url 2>/dev/null)" \
    pnpm turbo build --filter=f3-region-pages

FROM --platform=linux/amd64 node:24-alpine AS runner
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Next.js standalone output (monorepo layout: server.js lives under
# apps/region-pages within .next/standalone, with the hoisted node_modules).
COPY --from=installer /app/apps/region-pages/.next/standalone ./
COPY --from=installer /app/apps/region-pages/.next/static ./apps/region-pages/.next/static
COPY --from=installer /app/apps/region-pages/public ./apps/region-pages/public

EXPOSE 8080
CMD ["node", "apps/region-pages/server.js"]
