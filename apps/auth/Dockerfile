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
RUN turbo prune f3-auth --docker

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

RUN pnpm turbo build --filter=f3-auth

# ---------- Stage 3: Production runner ----------
FROM node:24.18.0-alpine AS runner

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 auth

# Copy standalone output
COPY --from=installer --chown=auth:nodejs /app/apps/auth/.next/standalone ./
COPY --from=installer --chown=auth:nodejs /app/apps/auth/.next/static ./apps/auth/.next/static
COPY --from=installer --chown=auth:nodejs /app/apps/auth/public ./apps/auth/public

# outputFileTracingIncludes in next.config forces the complete @img/sharp-libvips-*
# packages into the standalone trace; verify no external symlink dangles and every
# runtime sharp (hashed external + complete traced pnpm copies) actually loads.
RUN node -e "const fs=require('fs'),p=process.cwd()+'/',d='apps/auth/.next/node_modules';if(fs.existsSync(d))for(const n of fs.readdirSync(d)){const f=p+d+'/'+n;if(!fs.existsSync(f))throw Error('dangling external symlink: '+f);if(n.startsWith('sharp-'))require(fs.realpathSync(f))}for(const n of fs.readdirSync('node_modules/.pnpm'))if(n.startsWith('sharp@')&&fs.existsSync('node_modules/.pnpm/'+n+'/node_modules/sharp/dist'))require(p+'node_modules/.pnpm/'+n+'/node_modules/sharp');console.log('sharp externals verified')"

USER auth

ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/auth/server.js"]
