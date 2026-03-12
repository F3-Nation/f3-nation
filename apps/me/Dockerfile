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
RUN turbo prune f3-me --docker

# ---------- Stage 2: Install + build ----------
FROM node:20-alpine AS installer

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1

RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.1 --activate

# Install dependencies from pruned lockfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY --from=builder /app/out/full/ .
RUN pnpm turbo build --filter=f3-me

# ---------- Stage 3: Production runner ----------
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 me

# Copy standalone output
COPY --from=installer --chown=me:nodejs /app/apps/me/.next/standalone ./
COPY --from=installer --chown=me:nodejs /app/apps/me/.next/static ./apps/me/.next/static
COPY --from=installer --chown=me:nodejs /app/apps/me/public ./apps/me/public

USER me

ENV PORT=3003
EXPOSE 3003

CMD ["node", "apps/me/server.js"]
