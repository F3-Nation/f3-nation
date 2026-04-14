# ---------------------------------------------------------------------------
# apps/reconciler/Dockerfile
#
# Multi-stage build for the redirect-platform reconciler Cloud Run Job.
#
# Layout mirrors the other f3-nation apps (`apps/auth/Dockerfile`,
# `apps/api/Dockerfile`): turbo prune -> install -> build. The runner
# copies the whole workspace rather than tightening the output tree,
# because pnpm workspace hoisting + the `@acme/redirect-platform-db`
# symlink make a minimal copy non-trivial. TODO(F3R5_004): tighten the
# runner stage when Cloud Run Jobs deploy wiring lands — this is a
# functional-first scaffold, not an optimized image.
#
# Cloud Run Jobs are one-shot processes; there is no HTTP port, no
# healthcheck, no long-running server. Cloud Scheduler invokes the job
# every 5 minutes per R5 Decision 6.
# ---------------------------------------------------------------------------

# ---------- Stage 1: Prune monorepo ----------
FROM node:20-alpine AS builder

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.1 --activate
RUN pnpm add -g turbo@^1.12.3

COPY . .
RUN turbo prune @acme/reconciler --docker

# ---------- Stage 2: Install + build ----------
FROM node:20-alpine AS installer

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.1 --activate
RUN pnpm add -g turbo@^1.12.3

# Install dependencies from pruned lockfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY --from=builder /app/out/full/ .

ENV NODE_ENV=production
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

RUN pnpm turbo build --filter=@acme/reconciler

# ---------- Stage 3: Production runner ----------
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 reconciler

# Copy the entire installed workspace. The reconciler loads `drizzle-orm`
# and `postgres` at runtime plus `@acme/redirect-platform-db` via pnpm
# workspace symlinks, so tightening the copy requires threading those
# hoisted stores. TODO(F3R5_004): narrow this to the minimal set.
COPY --from=installer --chown=reconciler:nodejs /app /app

USER reconciler

ENV NODE_ENV=production

CMD ["node", "apps/reconciler/dist/index.js"]
