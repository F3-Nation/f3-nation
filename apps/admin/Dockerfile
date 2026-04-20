FROM --platform=linux/amd64 node:20-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED 1
ENV TURBO_TELEMETRY_DISABLED 1

RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app
RUN yarn global add turbo@^1.12.3
COPY . .

# Prune the workspace to only include admin and its dependencies
RUN turbo prune f3-nation-admin --docker

FROM --platform=linux/amd64 node:20-alpine AS installer
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

ENV NODE_ENV production
ENV CI true
ENV SKIP_ENV_VALIDATION true

RUN yarn global add turbo@^1.12.3 pnpm@8.15.1

# Copy the pruned workspace
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# Install dependencies
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .

RUN wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' | tee -a /etc/apk/repositories && \
    apk add doppler

ARG DOPPLER_TOKEN
ARG ENVIRONMENT
RUN echo "Received DOPPLER_TOKEN (first 5 chars): ${DOPPLER_TOKEN:0:5}"

ENV DOPPLER_TOKEN=${DOPPLER_TOKEN}
RUN echo "Set ENV DOPPLER_TOKEN (first 5 chars): ${DOPPLER_TOKEN:0:5}"

# Debug steps to verify the token
RUN echo "Received DOPPLER_TOKEN (first 5 chars): ${DOPPLER_TOKEN:0:5}" && \
    if [ -z "$DOPPLER_TOKEN" ]; then \
        echo "Error: DOPPLER_TOKEN is not set"; \
        exit 1; \
    fi && \
    echo "Using token starting with: ${DOPPLER_TOKEN:0:5}"

# Use the token explicitly
RUN doppler setup -p f3-admin --token "$DOPPLER_TOKEN"

RUN doppler secrets download --no-file --format env > /app/apps/admin/.env
RUN doppler run -- sh -c "pnpm turbo build --filter=f3-nation-admin && pnpm -F db migrate"

FROM --platform=linux/amd64 node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl && apk update
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 admin
USER admin
EXPOSE 3000
ENV PORT 3000

ENV NODE_ENV production

COPY --from=installer /app/apps/admin/next.config.js ./
COPY --from=installer /app/apps/admin/package.json ./

COPY --from=installer --chown=admin:nodejs /app/apps/admin/.env ./apps/admin/.env
COPY --from=installer --chown=admin:nodejs /app/apps/admin/.next/standalone ./
COPY --from=installer --chown=admin:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=installer --chown=admin:nodejs /app/apps/admin/public ./apps/admin/public

CMD node apps/admin/server.js
