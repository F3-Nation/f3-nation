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

# outputFileTracingIncludes in next.config forces the complete @img/sharp-libvips-*
# packages into the standalone trace; verify no external symlink dangles and every
# runtime sharp (hashed external + complete traced pnpm copies) actually loads.
RUN node -e "const fs=require('fs'),p=process.cwd()+'/',d='apps/me/.next/node_modules';if(fs.existsSync(d))for(const n of fs.readdirSync(d)){const f=p+d+'/'+n;if(!fs.existsSync(f))throw Error('dangling external symlink: '+f);if(n.startsWith('sharp-'))require(fs.realpathSync(f))}for(const n of fs.readdirSync('node_modules/.pnpm'))if(n.startsWith('sharp@')&&fs.existsSync('node_modules/.pnpm/'+n+'/node_modules/sharp/dist'))require(p+'node_modules/.pnpm/'+n+'/node_modules/sharp');console.log('sharp externals verified')"

USER me

ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003

CMD ["node", "apps/me/server.js"]
