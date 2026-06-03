# ---------- Stage 1: Prune monorepo ----------
    ARG TURBO_VERSION=2
    FROM --platform=linux/amd64 node:24.14.1-alpine AS builder
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
    
    # ---------- Stage 2: Install + build ----------
    FROM --platform=linux/amd64 node:24.14.1-alpine AS installer
    ARG TURBO_VERSION
    
    ENV NEXT_TELEMETRY_DISABLED=1
    ENV TURBO_TELEMETRY_DISABLED=1
    ENV PNPM_HOME="/pnpm"
    ENV PATH="$PNPM_HOME:$PATH"
    ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    RUN apk add --no-cache libc6-compat openssl && apk update
    WORKDIR /app
    
    RUN corepack enable
    
    # Install dependencies from pruned lockfile
    COPY --from=builder /app/out/json/ .
    COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
    RUN pnpm install --frozen-lockfile
    
    # Copy source and build
    COPY --from=builder /app/out/full/ .
    
    ENV NODE_ENV=production
    ENV CI=true
    ENV SKIP_ENV_VALIDATION=true
    
    RUN pnpm turbo build --filter=f3-api
    
    # ---------- Stage 3: Production runner ----------
    FROM --platform=linux/amd64 node:24.14.1-alpine AS runner
    
    RUN apk add --no-cache libc6-compat openssl && apk update
    WORKDIR /app
    
    RUN addgroup --system --gid 1001 nodejs && \
        adduser --system --uid 1001 api
    
    # Copy standalone output
    COPY --from=installer --chown=api:nodejs /app/apps/api/.next/standalone ./
    COPY --from=installer --chown=api:nodejs /app/apps/api/.next/static ./apps/api/.next/static
    
    USER api
    
    ENV PORT=8080
    EXPOSE 8080
    
    CMD ["node", "apps/api/server.js"]