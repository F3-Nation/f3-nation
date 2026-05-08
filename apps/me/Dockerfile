# ---------- Stage 1: Prune monorepo ----------
FROM --platform=linux/amd64 node:24-alpine AS builder

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g turbo@1.12.5

COPY . .
RUN turbo prune f3-me --docker

# ---------- Stage 2: Install + build ----------
FROM --platform=linux/amd64 node:24-alpine AS installer

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g turbo@1.12.5
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Install dependencies from pruned lockfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Install dependencies with pnpm version from root package.json "packageManager"
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY --from=builder /app/out/full/ .
RUN pnpm turbo build --filter=f3-me

# ---------- Stage 3: Production runner ----------
FROM --platform=linux/amd64 node:24-alpine AS runner

RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 me

# Copy standalone output
COPY --from=installer --chown=me:nodejs /app/apps/me/.next/standalone ./
COPY --from=installer --chown=me:nodejs /app/apps/me/.next/static ./apps/me/.next/static
COPY --from=installer --chown=me:nodejs /app/apps/me/public ./apps/me/public

USER me

ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003

CMD ["node", "apps/me/server.js"]
