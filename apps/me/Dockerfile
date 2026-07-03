# ---------- Stage 1: Prune monorepo ----------
ARG TURBO_VERSION=2
FROM node:24.18.0-alpine AS builder
ARG TURBO_VERSION

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g turbo@${TURBO_VERSION}

COPY . .
RUN turbo prune f3-me --docker

# ---------- Stage 2: Install + build ----------
FROM node:24.18.0-alpine AS installer
ARG TURBO_VERSION

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Install dependencies from pruned lockfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Install dependencies with pnpm version from root package.json "packageManager"
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY --from=builder /app/out/full/ .

# `turbo prune` copies the full catalog into pnpm-workspace.yaml but only this
# app's subset into the pruned lockfile. pnpm's verify-deps-before-run check (run
# by `pnpm run build`) flags that as catalog drift under strict catalogMode and
# fails the frozen install. Deps are already installed via the explicit frozen
# install above, so skip the redundant pre-run verification.
RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml

RUN pnpm turbo build --filter=f3-me

# ---------- Stage 3: Production runner ----------
FROM node:24.18.0-alpine AS runner

RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 me

# Copy standalone output
COPY --from=installer --chown=me:nodejs /app/apps/me/.next/standalone ./
COPY --from=installer --chown=me:nodejs /app/apps/me/.next/static ./apps/me/.next/static
COPY --from=installer --chown=me:nodejs /app/apps/me/public ./apps/me/public

# Reinstall sharp: Turbopack drops libvips and leaves a pnpm-store shadow; purge both, then verify.
RUN rm -rf ./node_modules/sharp ./node_modules/@img \
      ./node_modules/.pnpm/sharp@* ./node_modules/.pnpm/@img+* && \
    npm install --no-save --no-audit --no-fund sharp@0.35.2 && \
    node -e "require('sharp'); console.log('sharp loaded OK')"

USER me

ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003

CMD ["node", "apps/me/server.js"]
