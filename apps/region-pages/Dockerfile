# ---------- Stage 1: Prune monorepo ----------
ARG TURBO_VERSION=2
# Node 25+ images no longer bundle Corepack; install it so pnpm comes from
# the root packageManager pin (version and hash).
ARG COREPACK_VERSION=0.36.0
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder
ARG TURBO_VERSION

ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g turbo@${TURBO_VERSION}

COPY . .
RUN turbo prune f3-region-pages --docker

# ---------- Stage 2: Install + build ----------
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS installer
ARG TURBO_VERSION

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

RUN apk add --no-cache libc6-compat
WORKDIR /app

ARG COREPACK_VERSION
RUN npm install -g corepack@${COREPACK_VERSION} && corepack enable
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

RUN pnpm turbo build --filter=f3-region-pages

# Assert the next.config libvips tracing include landed (a zero-match glob is a silent no-op).
RUN test -n "$(find apps/region-pages/.next/standalone -name 'libvips-cpp*')"

# ---------- Stage 3: Production runner ----------
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runner

RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 regionpages

# Copy standalone output
COPY --from=installer --chown=regionpages:nodejs /app/apps/region-pages/.next/standalone ./
COPY --from=installer --chown=regionpages:nodejs /app/apps/region-pages/.next/static ./apps/region-pages/.next/static
COPY --from=installer --chown=regionpages:nodejs /app/apps/region-pages/public ./apps/region-pages/public

USER regionpages

ENV NODE_ENV=production
ENV PORT=3006
EXPOSE 3006

CMD ["node", "apps/region-pages/server.js"]
