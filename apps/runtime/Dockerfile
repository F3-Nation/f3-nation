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
RUN turbo prune @acme/runtime --docker

# ---------- Stage 2: Install + build ----------
FROM node:20-alpine AS installer

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
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

RUN pnpm turbo build --filter=@acme/runtime

# ---------- Stage 3: Production runner ----------
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 runtime

# Copy Next.js standalone output — this is a self-contained Node
# server including minimal node_modules and the `.next/standalone`
# directory. `.next/static` and `public` are the two things the
# standalone build doesn't copy automatically.
COPY --from=installer --chown=runtime:nodejs /app/apps/runtime/.next/standalone ./
COPY --from=installer --chown=runtime:nodejs /app/apps/runtime/.next/static ./apps/runtime/.next/static

USER runtime

# Cloud Run expects the container to listen on 0.0.0.0:$PORT. Next's
# standalone server honors HOSTNAME and PORT env vars.
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# No healthcheck — Cloud Run manages readiness via the revision's
# startup/liveness probes configured in Terraform.
CMD ["node", "apps/runtime/server.js"]
