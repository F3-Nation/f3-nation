# CLAUDE.md — LLM Context Index

> **Meta: This file MUST stay <8kb, compressed, LLM-friendly (not human-friendly). When editing, preserve density. Strip prose, use terse notation. This is a machine-readable index, not documentation.**

## Stack

Next.js 15 / React 19 / TypeScript (strict, `@/*` = `./src/*`) / Drizzle ORM / PostgreSQL (Supabase) / TailwindCSS / Node 20.18.2 (`.nvmrc`)

## Commands

```
dev              # localhost:3000
build            # ~480 static pages
lint | format | typecheck | test | test:watch | test:coverage (70% threshold)
db:setup:local | db:migrate | db:push | db:seed | db:reset | db:generate:migration
```

## Architecture

- RSC default; `'use client'` only for interactivity
- Build-aware cache keys via `NEXT_BUILD_ID` — see `src/utils/fetchWorkoutLocations.ts` / `getBuildAwareCacheKey()`
- ISR via `generateStaticParams()` in `[regionSlug]/page.tsx`
- Chunk error recovery: `src/components/ChunkErrorRecovery.tsx`

## Key Files

```
drizzle/schema.ts                        # DB schema (regions, workouts, seedRuns)
drizzle/db.ts                            # DB instance
src/utils/fetchWorkoutLocations.ts       # Central data fetch + caching
src/app/[regionSlug]/page.tsx            # Region page (ISR)
src/app/api/ingest/route.ts              # Cron ingest endpoint
src/components/ChunkErrorRecovery.tsx    # Client chunk error recovery
```

## API: POST /api/ingest

Upstash QStash cron. Bearer `CRON_SECRET`. Idempotent (20h window). Prunes stale data, seeds regions/workouts from warehouse, enriches metadata. Slack notifications on all outcomes (success/failure/skip). See `.context/slack.md`.

```bash
curl -X POST http://localhost:3000/api/ingest -H "Authorization: Bearer $CRON_SECRET"
```

## Env (`.env.local.sample`)

```
POSTGRES_URL               # Supabase connection
F3_DATA_WAREHOUSE_URL      # Warehouse connection
CRON_SECRET                # Ingest auth
SLACK_BOT_AUTH_TOKEN        # Bot OAuth token (xoxb-...)
SLACK_CHANNEL_ID            # Notification channel
```

## Agent Skills (`.agents/skills/`)

- `vercel-react-best-practices` — 57 React/Next.js perf rules (8 categories). Use when writing/reviewing components.
- `vercel-composition-patterns` — Composition patterns for scalable components. Use for boolean-prop refactors, reusable APIs, React 19 patterns.

## Context Index (`.context/`)

| File       | Topic                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `slack.md` | Slack bot integration: `sendSlackNotification`, env vars, notification triggers, warehouse Slack tables |
