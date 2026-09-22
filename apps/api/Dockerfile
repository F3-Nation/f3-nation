# ---------- Stage 1: Prune monorepo ----------
    ARG TURBO_VERSION=2
    FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS builder
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
    FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS installer
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

    # Next.js inlines NEXT_PUBLIC_* at `next build` time into BOTH the client
    # bundle and the standalone server output — a Cloud Run runtime env var
    # for a NEXT_PUBLIC_* name does nothing on its own. These must be present
    # during the image build. Defaults empty: keyless builds succeed and
    # client PostHog is simply disabled (see instrumentation-client.ts).
    ARG NEXT_PUBLIC_POSTHOG_KEY
    ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
    # Defaulted, NOT bare: a bare `ARG` expands to an EMPTY STRING when no
    # --build-arg is supplied, and the ENV below then bakes "" into the client
    # bundle. env.ts validates this as z.enum(["true","false"]).optional(),
    # which accepts an ABSENT var but rejects "" — and the browser has neither
    # CI nor SKIP_ENV_VALIDATION set, so t3-env throws on import of ~/env and
    # the app white-screens. preview-env.yml builds this image without the arg,
    # so this default is load-bearing, not cosmetic.
    ARG NEXT_PUBLIC_POSTHOG_SESSION_RECORDING=false
    ENV NEXT_PUBLIC_POSTHOG_SESSION_RECORDING=$NEXT_PUBLIC_POSTHOG_SESSION_RECORDING

    # `turbo prune` copies the full catalog into pnpm-workspace.yaml but only this
    # app's subset into the pruned lockfile. pnpm's verify-deps-before-run check (run
    # by `pnpm run build`) flags that as catalog drift under strict catalogMode and
    # fails the frozen install. Deps are already installed via the explicit frozen
    # install above, so skip the redundant pre-run verification.
    RUN printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml

    RUN pnpm turbo build --filter=f3-api

    # Assert the next.config libvips tracing include landed (a zero-match glob is a silent no-op).
    RUN test -n "$(find apps/api/.next/standalone -name 'libvips-cpp*')"

    # ---------- Stage 3: Production runner ----------
    FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS runner
    
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
