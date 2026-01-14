# Slack Bot Migration Blueprint

> **Migration from Python/Slack Bolt to TypeScript/Bolt within F3-Nation Turborepo**

## Executive Summary

This document outlines the migration strategy for moving the F3 Nation Slack bot from its current Python implementation (`apps/slackbot/python_ref/f3-nation-slack-bot`) to a TypeScript application leveraging the existing monorepo infrastructure. The migration will:

- Use **TypeScript** with **@slack/bolt** for the Slack app
- Integrate with **oRPC** (replacing direct SQLAlchemy DB calls) via `@acme/api`
- Follow established monorepo patterns from `packages/` and `apps/`
- Extend the API with new endpoints for Slack-specific operations

---

## Table of Contents

1. [Python Codebase Analysis](#1-python-codebase-analysis)
2. [Monorepo Pattern Analysis](#2-monorepo-pattern-analysis)
3. [File Mapping: Python → TypeScript](#3-file-mapping-python--typescript)
4. [Required Dependencies](#4-required-dependencies)
5. [Shared vs App-Specific Logic](#5-shared-vs-app-specific-logic)
6. [New API Endpoints Required](#6-new-api-endpoints-required)
7. [Migration Phases](#7-migration-phases)
8. [Risk Assessment](#8-risk-assessment)

---

## 1. Python Codebase Analysis

### 1.1 Application Entry Point

The Python app (`main.py`) uses Slack Bolt with a unique routing pattern:

```python
# All events route through a single main_response handler
MATCH_ALL_PATTERN = re.compile(".*")
app.action(MATCH_ALL_PATTERN)(*ARGS)
app.view(MATCH_ALL_PATTERN)(*ARGS)
app.command(MATCH_ALL_PATTERN)(*ARGS)
# ... etc
```

The `main_response` function then dispatches to specific handlers via `MAIN_MAPPER` in `utilities/routing.py`.

### 1.2 Routing Architecture (utilities/routing.py)

| Mapper Type          | Description                                                      | Handler Count |
| -------------------- | ---------------------------------------------------------------- | ------------- |
| `COMMAND_MAPPER`     | Slash commands (`/backblast`, `/preblast`, `/f3-calendar`, etc.) | 6             |
| `VIEW_MAPPER`        | Modal view submissions                                           | 33            |
| `ACTION_MAPPER`      | Button clicks, select menus, interactive components              | 98            |
| `VIEW_CLOSED_MAPPER` | Modal close events                                               | 2             |
| `EVENT_MAPPER`       | Slack workspace events (`team_join`, `app_mention`)              | 2             |
| `OPTIONS_MAPPER`     | Dynamic options for select menus                                 | 4             |
| `SHORTCUT_MAPPER`    | Global and message shortcuts                                     | 5             |

### 1.3 Feature Modules (features/)

| File                                 | Description                        | Key Functions                                                                                           |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `backblast.py` (737 lines)           | Post-workout reports               | `backblast_middleware`, `build_backblast_form`, `handle_backblast_post`, `handle_backblast_edit_button` |
| `backblast_legacy.py`                | Legacy backblast support           | Similar to backblast.py                                                                                 |
| `preblast.py` / `preblast_legacy.py` | Pre-workout announcements          | `handle_preblast_post`, `handle_preblast_edit_button`                                                   |
| `welcome.py`                         | New member welcomes                | `handle_team_join`, `build_welcome_config_form`, `handle_welcome_message_config_post`                   |
| `help.py`                            | Help menu and @mentions            | `build_help_menu`, `handle_app_mention`                                                                 |
| `config.py`                          | Region settings                    | `build_config_form`, `handle_config_*_post` functions                                                   |
| `connect.py`                         | Region connection/linking          | OAuth flows, region approval                                                                            |
| `strava.py`                          | Strava integration                 | OAuth token exchange, activity sync                                                                     |
| `weaselbot.py`                       | Achievements/gamification          | `build_achievement_form`, `handle_achievements_tag`                                                     |
| `user.py`                            | User profile management            | `build_user_form`, `handle_user_form`                                                                   |
| `region.py`                          | Region info editing                | `build_region_form`, `handle_region_edit`                                                               |
| `db_admin.py`                        | Admin-only functions (secret menu) | Secret menu, migrations, announcements                                                                  |
| `custom_fields.py`                   | Custom field definitions           | CRUD for custom backblast fields                                                                        |
| `paxminer_mapping.py`                | PaxMiner channel mapping           | Legacy PaxMiner integration                                                                             |
| `reporting.py`                       | Reporting configuration            | Monthly reporting settings                                                                              |

### 1.4 Calendar Submodule (features/calendar/)

| File                | Description                            |
| ------------------- | -------------------------------------- |
| `home.py`           | Calendar home view, event navigation   |
| `series.py`         | Recurring event series CRUD            |
| `event_instance.py` | Single event instance management       |
| `event_preblast.py` | Event preblast posting                 |
| `event_type.py`     | Event type definitions                 |
| `event_tag.py`      | Event tagging (anniversaries, special) |
| `ao.py`             | AO (workout location) management       |
| `location.py`       | Physical location CRUD                 |
| `config.py`         | Calendar configuration                 |

### 1.5 Utilities (utilities/)

| File/Dir              | Purpose                      | Migration Strategy                                                                                     |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `routing.py`          | Central routing mapper       | Recreate in TypeScript                                                                                 |
| `constants.py`        | App constants, templates     | Migrate to `src/constants/`                                                                            |
| `helper_functions.py` | 30+ utility functions        | Extract to shared utilities                                                                            |
| `builders.py`         | Modal/message builders       | Migrate to `src/lib/builders.ts`                                                                       |
| `options.py`          | Dynamic options handlers     | Migrate to feature modules                                                                             |
| `sendmail.py`         | Email notifications          | Use existing `@acme/api` mail service                                                                  |
| `slack/actions.py`    | 323 action ID constants      | Migrate to feature modules for non-shared components, `src/constants/actions.ts` for shared components |
| `slack/forms.py`      | Form/modal definitions       | Migrate to feature modules for non-shared components, `src/components/` for shared components          |
| `slack/orm.py`        | Slack Block Kit abstractions | Migrate to `@slack/types` and `src/lib/blocks.ts`                                                      |
| `database/`           | SQLAlchemy DB operations     | **Replace with oRPC API calls**                                                                        |

### 1.6 Scheduled Scripts (scripts/)

| Script                   | Purpose                    | Migration Notes       |
| ------------------------ | -------------------------- | --------------------- |
| `auto_preblast_send.py`  | Automated preblast posting | Part of Cloud Run Job |
| `award_achievements.py`  | Achievement calculations   | Part of Cloud Run Job |
| `backblast_reminders.py` | Reminder DMs               | Part of Cloud Run Job |
| `preblast_reminders.py`  | Preblast reminders         | Part of Cloud Run Job |
| `q_lineups.py`           | Q lineup notifications     | Part of Cloud Run Job |
| `monthly_reporting.py`   | Monthly stats reports      | Part of Cloud Run Job |
| `update_slack_users.py`  | Sync Slack user data       | Part of Cloud Run Job |
| `calendar_images.py`     | Generate calendar images   | Part of Cloud Run Job |
| `hourly_runner.py`       | Hourly job orchestrator    | Cloud Scheduler       |

### 1.7 External Integrations

| Integration                | Current Implementation      | TypeScript Approach          |
| -------------------------- | --------------------------- | ---------------------------- |
| **Slack API**              | slack-bolt + slack-sdk      | @slack/bolt + @slack/types   |
| **PostgreSQL**             | SQLAlchemy + F3-Data-Models | oRPC via @acme/api + Drizzle |
| **MySQL (PaxMiner)**       | SQLAlchemy (pymysql)        | New oRPC endpoints if needed |
| **Strava**                 | requests + OAuth            | Node.js fetch + OAuth        |
| **AWS S3**                 | boto3 (image storage)       | @aws-sdk/client-s3           |
| **GCP Storage**            | google-cloud-storage        | @google-cloud/storage        |
| **Email**                  | smtplib                     | Use @acme/api mail service   |
| **Google Cloud Functions** | functions-framework         | Express/Fastify or Cloud Run |

---

## 2. Monorepo Pattern Analysis

### 2.1 Package Structure Standards

Based on analysis of existing apps (`apps/map`, `apps/api`):

```json
{
  "name": "f3-nation-slackbot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm with-env tsx watch src/index.ts",
    "build": "tsc",
    "start": "pnpm with-env node dist/index.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --check .",
    "with-env": "dotenv -e ../../.env --"
  }
}
```

### 2.2 Tooling Configuration

| Tool           | Config Source              | Notes                           |
| -------------- | -------------------------- | ------------------------------- |
| **ESLint**     | `@acme/eslint-config/base` | No React/Next.js configs needed |
| **Prettier**   | `@acme/prettier-config`    | 2-space indentation             |
| **TypeScript** | `@acme/tsconfig`           | Strict mode, ES modules         |
| **Testing**    | Vitest                     | Match existing patterns         |

### 2.3 Shared Package Dependencies

```json
{
  "dependencies": {
    "@acme/api": "workspace:^0.1.0",
    "@acme/db": "workspace:^0.1.0",
    "@acme/env": "workspace:^0.1.0",
    "@acme/shared": "workspace:^0.1.0",
    "@acme/validators": "workspace:^0.1.0"
  }
}
```

### 2.4 Logging Pattern

From `AGENTS.md`: Use structured logging. For production, integrate with GCP Cloud Logging similar to Python's `StructuredLogHandler`.

### 2.5 Modal Navigation & Stack Management

Slack has two critical limits that this bot addresses via a unified navigation system:

- **3-View Push Limit**: Slack only allows 3 modals in a stack.
- **3-Second Trigger ID Expiration**: `trigger_id` must be used within 3 seconds.

#### The Pattern: "Immediate Load, Lazy Hydrate"

Use `navigateToView()` from `src/lib/view-navigation.ts` for all modal transitions.

- **Automatic Depth Tracking**: The utility tracks `_navDepth` in `private_metadata`. It uses `views.push` for depth < 2 and automatically switches to `views.update` for depth ≥ 2.
- **Loading Screens**: For any view requiring async data fetching (oRPC), set `showLoading: true`. This immediately pushes/updates a loading modal to satisfy the 3-second `trigger_id` limit, then hydrates with real data once available.

```typescript
// Example: Navigation with async data
const navCtx = createNavContext(args);
await navigateToView(
  navCtx,
  async () => {
    const data = await api.feature.getData();
    return buildFeatureModal(data);
  },
  { showLoading: true, loadingTitle: "Loading..." },
);
```

---

## 3. File Mapping: Python → TypeScript

### 3.1 Core Application Files

| Python File                     | TypeScript Equivalent      | Notes                                     |
| ------------------------------- | -------------------------- | ----------------------------------------- |
| `main.py`                       | `src/index.ts`             | Bolt app initialization                   |
| `utilities/routing.py`          | `src/router/index.ts`      | Feature-based routing                     |
| `utilities/constants.py`        | `src/constants/index.ts`   | App constants                             |
| `utilities/helper_functions.py` | `src/lib/helpers.ts`       | Utility functions                         |
| `utilities/builders.py`         | `src/lib/builders.ts`      | Modal/message builders                    |
| `utilities/slack/actions.py`    | `src/constants/actions.ts` | Action ID constants for shared components |
| `utilities/slack/forms.py`      | `src/components/forms/`    | Form definitions for shared components    |
| `utilities/slack/orm.py`        | `src/lib/blocks.ts`        | Block Kit abstractions                    |

### 3.2 Feature Modules

| Python Feature                        | TypeScript Path                           | Priority          |
| ------------------------------------- | ----------------------------------------- | ----------------- |
| `features/help.py`                    | `src/features/help/index.ts`              | P0 - Foundation   |
| `features/welcome.py`                 | `src/features/welcome/index.ts`           | P0 - Foundation   |
| `features/config.py`                  | `src/features/config/index.ts`            | P1 - Core         |
| `features/backblast.py`               | `src/features/backblast/index.ts`         | P1 - Core         |
| `features/preblast.py`                | `src/features/preblast/index.ts`          | P1 - Core         |
| `features/calendar/home.py`           | `src/features/calendar/home.ts`           | P1 - Core         |
| `features/calendar/series.py`         | `src/features/calendar/series.ts`         | P1 - Core         |
| `features/calendar/event_instance.py` | `src/features/calendar/event-instance.ts` | P1 - Core         |
| `features/calendar/event_preblast.py` | `src/features/calendar/event-preblast.ts` | P1 - Core         |
| `features/calendar/location.py`       | `src/features/calendar/location.ts`       | P2 - Extended     |
| `features/calendar/ao.py`             | `src/features/calendar/ao.ts`             | P2 - Extended     |
| `features/calendar/event_type.py`     | `src/features/calendar/event-type.ts`     | P2 - Extended     |
| `features/calendar/event_tag.py`      | `src/features/calendar/event-tag.ts`      | P2 - Extended     |
| `features/strava.py`                  | `src/features/strava/index.ts`            | P2 - Extended     |
| `features/connect.py`                 | `src/features/connect/index.ts`           | P2 - Extended     |
| `features/user.py`                    | `src/features/user/index.ts`              | P2 - Extended     |
| `features/region.py`                  | `src/features/region/index.ts`            | P2 - Extended     |
| `features/weaselbot.py`               | `src/features/achievements/index.ts`      | P3 - Nice-to-have |
| `features/custom_fields.py`           | `src/features/custom-fields/index.ts`     | P3 - Nice-to-have |
| `features/db_admin.py`                | `src/features/admin/index.ts`             | P3 - Nice-to-have |
| `features/reporting.py`               | `src/features/reporting/index.ts`         | P3 - Nice-to-have |
| `features/paxminer_mapping.py`        | `src/features/paxminer/index.ts`          | P4 - Legacy       |
| `features/backblast_legacy.py`        | `src/features/backblast/legacy.ts`        | P4 - Legacy       |
| `features/preblast_legacy.py`         | `src/features/preblast/legacy.ts`         | P4 - Legacy       |

### 3.3 Proposed Directory Structure

```
apps/slackbot/
├── .env.example
├── Dockerfile
├── README.md
├── MIGRATION.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                    # App entry point
    ├── app.ts                      # Bolt app configuration
    ├── middleware.ts               # Custom middleware
    ├── constants/
    │   ├── index.ts
    │   ├── actions.ts              # Action IDs
    │   └── templates.ts            # Message templates
    ├── router/
    │   ├── index.ts                # Central router
    │   ├── commands.ts             # Command handlers
    │   ├── actions.ts              # Action handlers
    │   ├── views.ts                # View submission handlers
    │   └── events.ts               # Event handlers
    ├── features/
    │   ├── help/
    │   │   ├── index.ts
    │   │   └── handlers.ts
    │   ├── welcome/
    │   │   ├── index.ts
    │   │   └── handlers.ts
    │   ├── backblast/
    │   │   ├── index.ts
    │   │   ├── handlers.ts
    │   │   └── forms.ts
    │   ├── preblast/
    │   │   └── ...
    │   ├── calendar/
    │   │   ├── home.ts
    │   │   ├── series.ts
    │   │   ├── event-instance.ts
    │   │   └── ...
    │   ├── config/
    │   │   └── ...
    │   └── ... (other features)
    ├── lib/
    │   ├── api-client.ts           # oRPC client setup
    │   ├── blocks.ts               # Block Kit helpers
    │   ├── builders.ts             # Modal/message builders
    │   ├── helpers.ts              # Utility functions
    │   └── logger.ts               # Structured logging
    ├── types/
    │   ├── index.ts
    │   ├── slack.ts                # Extended Slack types
    │   └── region.ts               # Region context types
    └── __tests__/
        └── ...
```

---

## 4. Required Dependencies

### 4.1 Production Dependencies

```json
{
  "dependencies": {
    "@slack/bolt": "^4.6.0",
    "@slack/web-api": "^7.13.0",
    "@slack/types": "^2.19.0",
    "@acme/api": "workspace:^0.1.0",
    "@acme/db": "workspace:^0.1.0",
    "@acme/env": "workspace:^0.1.0",
    "@acme/shared": "workspace:^0.1.0",
    "@acme/validators": "workspace:^0.1.0",
    "@orpc/client": "^1.8.8",
    "dotenv-cli": "^7.3.0",
    "zod": "^3.25.8",
    "dayjs": "^1.11.10"
  }
}
```

### 4.2 Development Dependencies

```json
{
  "devDependencies": {
    "@acme/eslint-config": "workspace:^0.2.0",
    "@acme/prettier-config": "workspace:^0.1.0",
    "@acme/tsconfig": "workspace:*",
    "eslint": "^8.56.0",
    "prettier": "^3.2.5",
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    "vitest": "^1.5.0",
    "@types/node": "^20.11.13"
  }
}
```

### 4.3 Optional Dependencies (Based on Features)

| Feature            | Dependency              | Notes                |
| ------------------ | ----------------------- | -------------------- |
| Strava Integration | Native fetch            | No extra deps needed |
| S3 Image Upload    | `@aws-sdk/client-s3`    | If AWS S3 is used    |
| GCP Storage        | `@google-cloud/storage` | If GCP is used       |
| Image Processing   | `sharp`                 | For image resizing   |

---

## 5. Shared vs App-Specific Logic

### 5.1 Candidates for `packages/shared`

| Logic                           | Current Location                | Recommendation                      |
| ------------------------------- | ------------------------------- | ----------------------------------- |
| Date/time utilities             | `utilities/helper_functions.py` | Move to `@acme/shared/date`         |
| Safe nested access (`safe_get`) | `utilities/helper_functions.py` | Use lodash `get` from existing deps |
| Constants (ORG_TYPES, etc.)     | `utilities/constants.py`        | Move to `@acme/shared/constants`    |
| Event cadence enums             | `F3-Data-Models/models.py`      | Already in `@acme/db` schema        |

### 5.2 Candidates for `packages/api` (New Endpoints)

These are database operations currently done directly via SQLAlchemy that should become API endpoints:

| Operation                   | Current Method                 | New API Endpoint                          |
| --------------------------- | ------------------------------ | ----------------------------------------- |
| Get Slack space by team ID  | `SlackSpace.find_by_team_id()` | `slack.getSpace` ✅ (exists)              |
| Update Slack space settings | `SlackSpace.update()`          | `slack.updateSpaceSettings` (new)         |
| Get/create Slack user       | `SlackUser` CRUD               | `slack.getUser`, `slack.upsertUser` (new) |
| Get region record           | Complex query                  | `slack.getRegion` (new)                   |
| Attendance CRUD             | `Attendance`, `Attendance_x_*` | `attendance.*` (new routes)               |
| Event instance queries      | Complex multi-table            | Extend `event.*` routes                   |
| Backblast creation          | Multiple table inserts         | `backblast.create` (new)                  |
| User lookup by Slack ID     | `SlackUser` lookup             | `slack.getUserBySlackId` (new)            |

### 5.3 App-Specific Logic (Keep in `apps/slackbot`)

| Logic                            | Reason                 |
| -------------------------------- | ---------------------- |
| Slack Block Kit form definitions | Slack-specific UI      |
| Modal builders                   | Slack-specific         |
| Action/command routing           | App-specific routing   |
| Strava OAuth flow                | Integration-specific   |
| Message formatting               | Slack-specific         |
| Welcome message templates        | Slack-specific content |

---

## 6. New API Endpoints Required

### 6.0 API Design Philosophy: Task-Oriented vs Entity CRUD

The API should expose **task-oriented endpoints** for complex business operations, not just entity-level CRUD. This distinction is critical for reusability across apps (slackbot, web, mobile, map).

#### Entity-Level CRUD (Low-Level)

Direct table operations — useful for admin tools or simple lookups:

```typescript
// Examples of entity CRUD (use sparingly from clients)
attendance.getById({ id: 123 });
attendance.create({ eventInstanceId, userId, ... });
attendanceType.list();
```

#### Task-Oriented Endpoints (Preferred)

Business logic operations that may span multiple tables atomically:

```typescript
// High-level operations that encapsulate business rules
event.signUpAsQ({ eventInstanceId, userId });
event.signUpAsPax({ eventInstanceId, userId });
event.removeFromQ({ eventInstanceId, userId });
backblast.submitWithAttendance({ backblastData, attendeeUserIds, qUserIds });
```

**Example: "Sign up as Q" Operation**

When a user signs up to Q an event, the following must happen atomically:

1. Create or update an `attendance` record for the user/event
2. Create an `attendance_x_attendance_type` record linking to the "Q" attendance type
3. (Optional) Update the event instance's `q_user_id` if applicable

This should be a **single API call** like `event.signUpAsQ`, not multiple calls from the client to manipulate individual tables. Benefits:

- **Atomicity**: All-or-nothing transaction
- **Encapsulation**: Clients don't need to know schema details
- **Reusability**: Same logic works for slackbot, web, mobile
- **Evolvability**: Schema changes don't break clients

> [!IMPORTANT]
> The slackbot should call task-oriented endpoints wherever possible. Direct entity CRUD should be reserved for simple lookups or admin operations.

---

### 6.1 Slack Router Extensions (`packages/api/src/router/slack.ts`)

```typescript
// Proposed new endpoints
export const slackRouter = {
  // Existing
  getSpace: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .handler(/* ... */),

  // New endpoints needed
  updateSpaceSettings: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        settings: SlackSettingsSchema,
      }),
    )
    .handler(/* ... */),

  getRegion: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .handler(/* ... */),

  getUserBySlackId: publicProcedure
    .input(
      z.object({
        slackId: z.string(),
        teamId: z.string(),
      }),
    )
    .handler(/* ... */),

  upsertUser: protectedProcedure
    .input(SlackUserUpsertSchema)
    .handler(/* ... */),

  listUsersForOrg: publicProcedure
    .input(z.object({ orgId: z.number() }))
    .handler(/* ... */),
};
```

### 6.2 New Backblast Router (`packages/api/src/router/backblast.ts`)

```typescript
export const backblastRouter = {
  create: protectedProcedure
    .input(BackblastCreateSchema)
    .handler(/* Create backblast with attendance records */),

  update: protectedProcedure
    .input(BackblastUpdateSchema)
    .handler(/* Update existing backblast */),

  getByMessageTs: publicProcedure
    .input(
      z.object({
        channelId: z.string(),
        messageTs: z.string(),
      }),
    )
    .handler(/* Find backblast by Slack message */),
};
```

### 6.3 Extended Attendance Router (`packages/api/src/router/attendance.ts`)

```typescript
export const attendanceRouter = {
  recordAttendance: protectedProcedure
    .input(AttendanceRecordSchema)
    .handler(/* Record attendance for event */),

  getForEventInstance: publicProcedure
    .input(z.object({ eventInstanceId: z.number() }))
    .handler(/* Get all attendees for event */),

  removeAttendance: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.number(),
        userId: z.number(),
      }),
    )
    .handler(/* Remove user from event */),
};
```

---

## 7. Migration Phases

### Phase 0: Foundation (Week 1)

- [x] Create `apps/slackbot` directory structure
- [x] Set up `package.json` with dependencies
- [x] Configure TypeScript, ESLint, Prettier
- [x] Create basic Bolt app that responds to `/help`
- [x] Set up oRPC client connection
- [x] Implement logging infrastructure

### Phase 1: Core Features (Weeks 2-3)

- [x] Migrate routing infrastructure
- [x] Implement `welcome` feature (team_join event)
- [x] Implement `help` feature (commands + app_mention)
- [x] Implement basic `config` feature
- [x] Add required Slack API endpoints to `packages/api`

### Phase 2: Calendar & Backblast (Weeks 4-6)

- [ ] Implement calendar management
  - [x] Implement "AO" management (AOs are sub-regions)
  - [x] Implement location management
  - [ ] Implement event series management
  - [ ] Implement event instance management
  - [x] Implement event type management
  - [ ] Implement event tag management
  - [ ] Implement general calendar settings
- [ ] Implement preblast creation/editing
- [ ] Implement backblast creation/editing
- [ ] Add preblast/backblast/attendance API endpoints
- [ ] Implement calendar home view

### Phase 3: Extended Features (Weeks 7-8)

- [ ] Implement Strava integration
- [ ] Implement user profile management
- [ ] Implement region configuration
- [ ] Implement location/AO management

### Phase 4: Admin & Polish (Weeks 9-10)

- [ ] Implement admin features (db_admin)
- [ ] Implement achievements (weaselbot)
- [ ] Implement custom fields
- [ ] Add comprehensive tests
- [ ] Documentation

### Phase 5: Scheduled Jobs (Week 11)

- [ ] Migrate hourly runner infrastructure
- [ ] Implement reminder jobs
- [ ] Implement reporting jobs
- [ ] Set up Cloud Scheduler triggers

---

## 8. Risk Assessment

| Risk                           | Likelihood | Impact | Mitigation                              |
| ------------------------------ | ---------- | ------ | --------------------------------------- |
| OAuth token migration          | Medium     | High   | Export existing tokens, test thoroughly |
| Database schema differences    | Low        | Medium | Drizzle schema matches F3-Data-Models   |
| Complex modal state management | Low        | Medium | Mitigated via `navigateToView` utility  |
| Strava OAuth compatibility     | Medium     | Medium | Maintain same redirect URIs             |
| Performance regression         | Low        | Medium | Benchmark critical paths                |
| Feature parity gaps            | Medium     | High   | Comprehensive feature checklist         |
| Slack API rate limits          | Low        | Low    | Existing patterns handle this           |

---

## Appendix A: Environment Variables

Required environment variables for the TypeScript app:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-... # For socket mode
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...

# Database (via oRPC)
DATABASE_URL=postgresql://...

# Optional integrations
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=...

# App
LOCAL_DEVELOPMENT=true
SOCKET_MODE=true # For local development
STATS_URL=https://stats.f3nation.com
```

---

## Appendix B: Slack App Manifest

The existing `app_manifest.template.json` should be updated to point to the new TypeScript app endpoints. Key sections remain the same:

- OAuth scopes
- Event subscriptions
- Slash commands
- Interactivity URL

---

_Document created: 2025-12-25_
_Last updated: 2026-01-11_
