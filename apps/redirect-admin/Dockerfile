# ---------------------------------------------------------------------------
# apps/redirect-admin/Dockerfile
#
# Multi-stage build for the redirect-admin Cloud Run service.
# Layout mirrors apps/me and apps/auth: turbo prune -> install -> build.
# ---------------------------------------------------------------------------

# ---------- Stage 1: Prune monorepo ----------
FROM node:20-alpine AS builder

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm add -g turbo@^1.12.3

COPY . .
RUN turbo prune @acme/redirect-admin --docker

# ---------- Stage 2: Install + build ----------
FROM node:20-alpine AS installer

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV SKIP_ENV_VALIDATION=1

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm add -g turbo@^1.12.3

COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
RUN pnpm turbo build --filter=@acme/redirect-admin

# ---------- Stage 3: Production runner ----------
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 redirect-admin

COPY --from=installer --chown=redirect-admin:nodejs /app/apps/redirect-admin/.next/standalone ./
COPY --from=installer --chown=redirect-admin:nodejs /app/apps/redirect-admin/.next/static ./apps/redirect-admin/.next/static
COPY --from=installer --chown=redirect-admin:nodejs /app/apps/redirect-admin/public ./apps/redirect-admin/public

USER redirect-admin

ENV PORT=3006
EXPOSE 3006

CMD ["node", "apps/redirect-admin/server.js"]
