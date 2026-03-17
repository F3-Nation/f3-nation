FROM --platform=linux/amd64 node:20-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app
RUN yarn global add turbo@^1.12.3
COPY . .

# Prune the workspace to only include f3-auth and its dependencies
RUN turbo prune f3-auth --docker

FROM --platform=linux/amd64 node:20-alpine AS installer
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

ENV NODE_ENV=production
ENV CI=true
ENV SKIP_ENV_VALIDATION=true

RUN yarn global add turbo@^1.12.3 pnpm@8.15.1

# Copy the pruned workspace
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# Install dependencies
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .

RUN pnpm turbo build --filter=f3-auth

FROM --platform=linux/amd64 node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 auth
USER auth
EXPOSE 8080
ENV PORT=8080

ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=true

COPY --from=installer /app/apps/auth/next.config.js ./
COPY --from=installer /app/apps/auth/package.json ./

COPY --from=installer --chown=auth:nodejs /app/apps/auth/.next/standalone ./
COPY --from=installer --chown=auth:nodejs /app/apps/auth/.next/static ./apps/auth/.next/static
COPY --from=installer --chown=auth:nodejs /app/apps/auth/public ./apps/auth/public

CMD ["node", "apps/auth/server.js"]
