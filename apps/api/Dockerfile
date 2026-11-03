# ---------- Stage 1: Prune monorepo ----------
ARG TURBO_VERSION=2
# Node 25+ images no longer bundle Corepack; install it so pnpm comes from
# the root packageManager pin (version and hash).
ARG COREPACK_VERSION=0.36.0
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder
ARG TURBO_VERSION

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable
RUN npm install -g turbo@${TURBO_VERSION}

COPY . .
RUN turbo prune f3-api --docker

# ---------- Stage 2: Install + bundle ----------
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS installer

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable

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
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS smoke
WORKDIR /app
COPY --from=installer /bundle ./dist
COPY --from=installer /app/apps/api/public ./public
COPY --from=installer /app/apps/api/scripts/smoke.mjs ./smoke.mjs
RUN SKIP_ENV_VALIDATION=1 NODE_ENV=production node smoke.mjs && touch /tmp/smoke-ok

# ---------- Stage 4: Production runner ----------
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 api

COPY --from=smoke /tmp/smoke-ok /tmp/smoke-ok
COPY --from=installer --chown=api:nodejs /bundle ./dist
# serveStatic resolves ./public/favicon.ico against the working directory.
COPY --from=installer --chown=api:nodejs /app/apps/api/public ./public

USER api

# src/instrument.ts only registers error tracking when NODE_ENV is production.
ENV NODE_ENV=production

# The bundle reads this from process.env at runtime; without it error tracking
# is disabled (instrument.ts logs api.observability.posthog_disabled).
ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY

ENV PORT=8080
EXPOSE 8080

CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/server.js"]
