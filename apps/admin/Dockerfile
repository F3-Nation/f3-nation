# ---------- Stage 1: Prune monorepo ----------
ARG TURBO_VERSION=2
FROM node:24.18.0-alpine AS builder
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
RUN turbo prune f3-admin --docker

# ---------- Stage 2: Install + build ----------
FROM node:24.18.0-alpine AS installer
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
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY --from=builder /app/out/full/ .

ENV NODE_ENV=production
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

# `turbo prune` copies the full catalog into pnpm-workspace.yaml but only this
# app's subset into the pruned lockfile. pnpm's verify-deps-before-run check (run
# by `pnpm run build`) flags that as catalog drift under strict catalogMode and
# fails the frozen install. Deps are already installed via the explicit frozen
# install above, so skip the redundant pre-run verification.
RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml

RUN pnpm turbo build --filter=f3-admin

# ---------- Stage 3: Production runner ----------
FROM node:24.18.0-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 admin

# Copy standalone output
COPY --from=installer --chown=admin:nodejs /app/apps/admin/.next/standalone ./
COPY --from=installer --chown=admin:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=installer --chown=admin:nodejs /app/apps/admin/public ./apps/admin/public

# Reinstall sharp: Turbopack drops libvips and leaves a pnpm-store shadow; purge both, then verify.
RUN rm -rf ./node_modules/sharp ./node_modules/@img \
      ./node_modules/.pnpm/sharp@* ./node_modules/.pnpm/@img+* && \
    npm install --no-save --no-audit --no-fund sharp@0.35.2 && \
    node -e "require('sharp'); console.log('sharp loaded OK')"

USER admin

ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/admin/server.js"]
