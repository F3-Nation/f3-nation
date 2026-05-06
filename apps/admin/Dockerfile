# ---------- Stage 1: Prune monorepo ----------
FROM --platform=linux/amd64 node:24-alpine AS builder

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm add -g turbo@^1.12.3

COPY . .
RUN turbo prune f3-nation-admin --docker

# ---------- Stage 2: Install + build ----------
FROM --platform=linux/amd64 node:24-alpine AS installer

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
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

# Server-side placeholders: satisfy module-level init checks during next build
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
ENV EMAIL_SERVER=smtp://placeholder:placeholder@localhost:587
ENV EMAIL_FROM=noreply@placeholder.com

# Client-side: must be real values (baked into browser JS at build time)
ARG NEXT_PUBLIC_CHANNEL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAP_URL
ARG NEXT_PUBLIC_ADMIN_URL
ENV NEXT_PUBLIC_CHANNEL=$NEXT_PUBLIC_CHANNEL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MAP_URL=$NEXT_PUBLIC_MAP_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL

RUN pnpm turbo build --filter=f3-nation-admin

# ---------- Stage 3: Production runner ----------
FROM --platform=linux/amd64 node:24-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 admin

# Copy standalone output
COPY --from=installer --chown=admin:nodejs /app/apps/admin/.next/standalone ./
COPY --from=installer --chown=admin:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=installer --chown=admin:nodejs /app/apps/admin/public ./apps/admin/public

USER admin

ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/admin/server.js"]
