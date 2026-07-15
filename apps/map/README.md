# F3 Nation Map Application

This is the F3 Nation Map application, an interactive map for F3 Nation locations and events.

## Application Details

- **Port**: 3000
- **Framework**: Next.js
- **TypeScript**: Yes
- **Testing**: Playwright, Vitest

## Setup

1. **Navigate to the monorepo root**:

   ```bash
   cd f3-nation
   ```

2. **Install dependencies** (if not already installed):

   ```bash
   pnpm install
   ```

3. **Environment setup**:
   - Get env.zip from F3 Nation Slack
   - Unzip and rename to `.env`
   - Place the `.env` file in this directory (`apps/map/.env`)

4. **Database setup** - Add the service account API key:

   Insert a row into the `api_keys` table in your database:

   ```sql
   INSERT INTO api_keys (key, name, description, owner_id)
   VALUES ('f3_map_service_account', 'F3 Map Service Account', 'Provides Public Access', 1);
   ```

   This key enables unauthenticated access to the public map interface.

5. **Start development server**:

   ```bash
   # From the monorepo root, start only the map app
   pnpm dev --filter f3-map

   # Or navigate to the app directory and run directly
   cd apps/map
   pnpm dev
   ```

## Environment Variables

Environment variables are application-specific in this monorepo. The `.env` file should be placed in the application directory (`apps/map/`) rather than the monorepo root.

Required environment variables (typically provided in env.zip):

- Database connection strings
- Authentication secrets
- API keys
- Application configuration

## Development

### Running Tests

```bash
# Run all tests for the map app
pnpm test --filter f3-map

# Run specific test suites
cd apps/map
pnpm test    # Vitest unit tests
pnpm test:e2e # Playwright e2e (blocking tier)
```

### Building for Production

```bash
# Build the map application
pnpm build --filter f3-map
```

### Linting

```bash
# Run linting for the map app
pnpm lint --filter f3-map
```

## Features

- Interactive map interface
- Location management
- Event scheduling and display
- User authentication
- Responsive design

## Contributing Map Changes

Signed-in users can contribute changes to the map directly. Supported change
requests cover create, edit, move, and delete for AOs, locations, and workouts
(events) — for example creating a new AO with its location and first workout,
editing an AO's details (name, website, address, contact info) or a workout's
times, moving an AO to a different region or location, moving a workout to a
different AO, and deleting AOs or workouts.

How a submission is applied depends on the submitter's role for the affected
region(s):

- **Editors and admins** of every org affected by the change have their
  submission applied immediately — it appears on the live map right away and is
  recorded as approved.
- **Everyone else** has their submission queued as a pending change request.
  The admins/editors of the affected region review it (escalating up the org
  hierarchy if the region has none) before it appears on the live map.

**AO logos are not editable from the map.** The map shows an AO's current logo
as read-only. To add or change a logo, use Admin at
[admin.f3nation.com](https://admin.f3nation.com). Logo uploads have been removed
from the map entirely.

## Architecture

This application is built with:

- **Next.js 14** with App Router
- **React** with TypeScript
- **Tailwind CSS** for styling
- **oRPC** for type-safe API calls
- **Drizzle ORM** for database operations
- **Playwright** for end-to-end testing
- **Vitest** for unit testing

## Related Documentation

- [Main Monorepo README](../README.md) - Overview of the entire monorepo structure
- [API Package README](../../packages/api/README.md) - Backend API documentation
- [UI Package README](../../packages/ui/README.md) - Shared UI components
