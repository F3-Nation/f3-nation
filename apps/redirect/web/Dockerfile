# Monorepo Cloud Run image for f3-redirect-web (mirrors apps/me/Dockerfile):
# turbo prune → install pruned lockfile → turbo build → standalone runner.
# Build with the repo root as context: docker build --file apps/redirect/web/Dockerfile .

# ---------- Stage 1: Prune monorepo to just this app ----------
FROM --platform=linux/amd64 node:24-alpine AS builder
ENV TURBO_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@1.13.4
COPY . .
RUN turbo prune f3-redirect-web --docker

# ---------- Stage 2: Install + build ----------
FROM --platform=linux/amd64 node:24-alpine AS installer
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@1.13.4 && corepack enable
# A dummy DATABASE_URL only satisfies module-import guards during `next build`
# (all pages are dynamic — no DB query at build). Real value injected at runtime.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=builder /app/out/full/ .
RUN pnpm turbo build --filter=f3-redirect-web

# ---------- Stage 3: Production runner ----------
FROM --platform=linux/amd64 node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=installer --chown=nextjs:nodejs /app/apps/redirect/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/redirect/web/.next/static ./apps/redirect/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/redirect/web/public ./apps/redirect/web/public
USER nextjs
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "apps/redirect/web/server.js"]
