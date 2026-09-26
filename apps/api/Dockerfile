# ---------- Stage 1: Prune monorepo ----------
ARG TURBO_VERSION=2
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS builder
ARG TURBO_VERSION

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

RUN corepack enable
RUN npm install -g turbo@${TURBO_VERSION}

COPY . .
RUN turbo prune f3-api --docker

# ---------- Stage 2: Install + bundle ----------
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS installer

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN corepack enable

# Install dependencies from pruned lockfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY --from=builder /app/out/full/ .
# build.mjs derives esbuild's target from it; turbo prune does not carry it.
COPY --from=builder /app/.nvmrc ./.nvmrc

ENV NODE_ENV=production
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

# Invoked with plain `node`, not `pnpm run`/`turbo run`: pnpm's pre-run
# dependency verification flags the pruned lockfile's catalog subset as drift
# under strict catalogMode. esbuild bundles workspace packages from source, so
# no upstream build task is needed.
RUN node apps/api/scripts/build.mjs

# Install the bundle's externals (pino, pino-pretty, postgres) from the
# manifest build.mjs generated. There is no lockfile for it: direct versions
# are pinned exactly, transitive ones resolve at build time. The image is built
# once and promoted to production unchanged. Done outside /app because inside
# the workspace pnpm resolves the workspace root even with --ignore-workspace.
RUN cp -r apps/api/dist /bundle && \
    cd /bundle && \
    pnpm install --prod --ignore-workspace --no-frozen-lockfile

# ---------- Stage 3: Smoke test the bundle ----------
# Boots the bundle in the runner's layout and checks /health,
# /docs/openapi.json, /favicon.ico and SIGTERM shutdown. BuildKit only builds
# stages the target depends on, so the runner copies this stage's marker file.
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS smoke
WORKDIR /app
COPY --from=installer /bundle ./dist
COPY --from=installer /app/apps/api/public ./public
COPY --from=installer /app/apps/api/scripts/smoke.mjs ./smoke.mjs
RUN SKIP_ENV_VALIDATION=1 NODE_ENV=production node smoke.mjs && touch /tmp/smoke-ok

# ---------- Stage 4: Production runner ----------
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 api

COPY --from=smoke /tmp/smoke-ok /tmp/smoke-ok
COPY --from=installer --chown=api:nodejs /bundle ./dist
# serveStatic resolves ./public/favicon.ico against the working directory.
COPY --from=installer --chown=api:nodejs /app/apps/api/public ./public

USER api

# Next's standalone server.js forced this; the bundle does not, and
# src/instrument.ts only registers error tracking in production.
ENV NODE_ENV=production

# Next inlined this build arg into its server output; esbuild does not inline
# process.env, so it must reach the container as a runtime env var or error
# tracking is silently disabled.
ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY

ENV PORT=8080
EXPOSE 8080

CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/server.js"]
