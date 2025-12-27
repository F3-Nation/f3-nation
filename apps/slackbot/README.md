# F3 Nation Slack Bot

A TypeScript Slack bot built with [@slack/bolt](https://slack.dev/bolt-js/) for the F3 Nation community.

## Features

- `/help` - Display help menu with available commands
- Welcome messages for new team members
- Calendar management
- Backblast/Preblast posting
- (See [MIGRATION.md](./MIGRATION.md) for full feature list)

## Development

### Prerequisites

- Node.js >= 20.19
- pnpm 8.15.1+
- Slack App configured with appropriate scopes

### Setup

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

2. Configure your `.env` with Slack credentials from your [Slack App](https://api.slack.com/apps)

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Start development server:
   ```bash
   pnpm dev
   ```

### Commands

| Command          | Description                              |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Start development server with hot reload |
| `pnpm build`     | Build TypeScript to dist/                |
| `pnpm start`     | Run production build                     |
| `pnpm lint`      | Run ESLint                               |
| `pnpm typecheck` | Run TypeScript type checking             |
| `pnpm test`      | Run tests                                |

## Architecture

```
src/
├── index.ts           # App entry point
├── app.ts             # Bolt app configuration
├── middleware.ts      # Custom middleware
├── constants/         # Action IDs, templates
├── router/            # Event routing
├── features/          # Feature modules
├── lib/               # Shared utilities
└── types/             # TypeScript types
```

## Socket Mode vs HTTP Mode

For local development, the app uses **Socket Mode** which doesn't require a public URL.

For production, configure HTTP mode with appropriate endpoints.

## Related

- [MIGRATION.md](./MIGRATION.md) - Migration plan from Python implementation
- [packages/api](../../packages/api) - oRPC API for database operations
