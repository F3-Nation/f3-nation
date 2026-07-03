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
RUN turbo prune f3-map --docker

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
# Build-only: the Docker build has no DB/API access, so skip the build-time
# data fetch on `/` (renders empty). At runtime SKIP_SSG is unset, so ISR
# regeneration fetches real map data against the live DB. See page.tsx.
ENV SKIP_SSG=1

# `turbo prune` copies the full catalog into pnpm-workspace.yaml but only this
# app's subset into the pruned lockfile. pnpm's verify-deps-before-run check (run
# by `pnpm run build`) flags that as catalog drift under strict catalogMode and
# fails the frozen install. Deps are already installed via the explicit frozen
# install above, so skip the redundant pre-run verification.
RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml

RUN pnpm turbo build --filter=f3-map

# ---------- Stage 3: Production runner ----------
FROM node:24.18.0-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 map

# Copy standalone output
COPY --from=installer --chown=map:nodejs /app/apps/map/.next/standalone ./
COPY --from=installer --chown=map:nodejs /app/apps/map/.next/static ./apps/map/.next/static
COPY --from=installer --chown=map:nodejs /app/apps/map/public ./apps/map/public

# Reinstall sharp: Turbopack drops libvips and leaves a pnpm-store shadow; purge both,
# repoint Turbopack's hashed sharp-<hash> external symlinks (which targeted the purged
# pnpm copy) at the reinstalled sharp, fail on any dangling external, then verify.
RUN rm -rf ./node_modules/sharp ./node_modules/@img \
      ./node_modules/.pnpm/sharp@* ./node_modules/.pnpm/@img+* && \
    npm install --no-save --no-audit --no-fund sharp@0.35.2 && \
    node -e "const fs=require('fs'),d='apps/map/.next/node_modules';if(fs.existsSync(d))for(const n of fs.readdirSync(d)){const f=d+'/'+n;if(n.startsWith('sharp-')){fs.rmSync(f);fs.symlinkSync('/app/node_modules/sharp',f)}if(!fs.existsSync(f))throw Error('dangling external symlink: '+f)}" && \
    node -e "require('sharp'); console.log('sharp loaded OK')"

USER map

ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/map/server.js"]
