# F3 Nation Auth Provider

## Overview

Central authentication service for F3 Nation applications using Next.js, NextAuth, and PostgreSQL. This service provides email-based authentication with verification codes backed by PostgreSQL and delivered via SendGrid.

## Technical Stack

- Next.js 15.4.4 with App Router
- NextAuth 4.24.11 with custom email provider
- Raw PostgreSQL with type-safe repository pattern
- PostgreSQL database
- SendGrid for transactional email delivery
- TailwindCSS for styling

## Key Features

- **Email-based authentication** with verification codes
- **Custom MFA store** with hashed codes persisted in PostgreSQL
- **JWT sessions** with custom NextAuth adapter
- **OAuth provider** for other F3 Nation applications
- **User onboarding** with F3 name and hospital name
- **Session management** across subdomains
- **Responsive UI** with dark/light theme support

## Project Structure

```
auth-provider/
├── .env.local                    # Environment variables
├── package.json                  # Dependencies
├── db/
│   ├── index.ts                 # Database connection & repository exports
│   ├── client.ts                # DatabaseClient class
│   ├── types/                   # Type definitions
│   └── repositories/            # Repository pattern implementation
├── migrations/                   # SQL migration files
├── app/
│   ├── page.tsx                 # Home page
│   ├── login/
│   │   ├── page.tsx             # Login options
│   │   └── email/
│   │       ├── page.tsx         # Email input
│   │       └── verify/
│   │           └── page.tsx     # Code verification
│   ├── onboarding/
│   │   └── page.tsx             # User onboarding
│   └── api/
│       ├── auth/[...nextauth]/  # NextAuth handler
│       ├── verify-email/        # Email verification
│       ├── onboarding/          # Complete onboarding
│       ├── session/             # Session info
│       └── oauth/               # OAuth endpoints
├── lib/
│   ├── auth.ts                  # NextAuth configuration
│   ├── next-auth-adapter.ts     # Custom NextAuth adapter
│   └── mfa/
│       └── index.ts             # Email verification service
└── components/
    ├── SignOutButton.tsx        # Sign out component
    └── ThemeImage.tsx           # Theme-aware images
```

## Environment Variables

Create a `.env.local` file with the following variables:

```env
# NextAuth Configuration
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="http://localhost:3000"

# Database
DATABASE_URL="your-postgresql-connection-string"

# Email Verification
TWILIO_SENDGRID_API_KEY="your-sendgrid-api-key"
TWILIO_SENDGRID_TEMPLATE_ID="your-sendgrid-template-id"
EMAIL_VERIFICATION_SENDER="support.auth@f3nation.com"

# OAuth Client Secrets (for F3 applications)
OAUTH_CLIENT_SECRET_LOCAL_CLIENT="your-local-client-secret"
OAUTH_CLIENT_SECRET_F3_APP_CLIENT="your-f3-app-client-secret"
OAUTH_CLIENT_SECRET_F3_APP2_CLIENT="your-f3-app2-client-secret"
OAUTH_CLIENT_SECRET_AUTH_PROVIDER_LOCAL="your-auth-provider-local-secret"
OAUTH_CLIENT_SECRET_AUTH_PROVIDER_PROD="your-auth-provider-prod-secret"
```

## Development Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with your actual values
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:3000`.

## Database Commands

```bash
# Deploy migrations to database
npm run db:deploy
```

## Local Development Database

Run a local PostgreSQL instance with Docker for development without affecting staging/production.

### Environment Files

The workflow uses two environment files to separate concerns:

| File            | Purpose                                 | Used By                                |
| --------------- | --------------------------------------- | -------------------------------------- |
| `.env.firebase` | Production database URL for snapshots   | `npm run db:snapshot`                  |
| `.env.local`    | Local development database & app config | `npm run dev`, `npm run db:local:seed` |

**`.env.local`** should contain the local database URL:

```
DATABASE_URL=postgresql://f3prod:f3prod_local_dev@localhost:5433/f3prod_dev
```

**`.env.firebase`** should contain the production database URL (for taking snapshots):

```
DATABASE_URL=postgresql://user:pass@prod-host:5432/db
```

### Prerequisites

- Docker Desktop
- PostgreSQL client tools (`pg_dump`, `psql`)
  - macOS: `brew install libpq && brew link --force libpq`
  - Ubuntu: `sudo apt-get install postgresql-client`

### Workflow

```bash
# Take snapshot from production database (reads from .env.firebase)
npm run db:snapshot

# Start local PostgreSQL
npm run db:local:up

# Seed local database (reads from .env.local)
npm run db:local:seed

# Run dev server
npm run dev

# When done
npm run db:local:down
```

### Available Commands

| Command                  | Description                        |
| ------------------------ | ---------------------------------- |
| `npm run db:snapshot`    | Snapshot from DATABASE_URL         |
| `npm run db:local:up`    | Start local PostgreSQL container   |
| `npm run db:local:down`  | Stop container (preserves data)    |
| `npm run db:local:seed`  | Seed database from latest snapshot |
| `npm run db:local:reset` | Reset database (drop and recreate) |

### Connection Details

| Database   | User   | Password         | Connection String                                                |
| ---------- | ------ | ---------------- | ---------------------------------------------------------------- |
| f3prod_dev | f3prod | f3prod_local_dev | `postgresql://f3prod:f3prod_local_dev@localhost:5433/f3prod_dev` |

### Notes

- Snapshots are stored in `db-snapshots/latest/<timestamp>/`
- The database runs in a Docker container on port 5433
- Don't share snapshots externally as they contain auth and production data
- Use `npm run db:local:down --remove-data` to completely reset the Docker volume

## Authentication Flow

1. **User visits login page** and chooses email authentication
2. **User enters email address** and receives verification code via email
3. **User enters verification code** to complete authentication
4. **New users complete onboarding** with F3 name and hospital name
5. **User is redirected** to the requesting application

## OAuth Provider

This service acts as an OAuth 2.0 provider for other F3 Nation applications:

- **Authorization endpoint:** `/api/oauth/authorize`
- **Token endpoint:** `/api/oauth/token`
- **User info endpoint:** `/api/oauth/userinfo`
- **OpenID configuration:** `/api/.well-known/openid_configuration`

### Supported OAuth Clients

The system supports multiple OAuth clients configured in `oauth-clients.ts`:

- `local-client` - Local development client
- `f3-app-client` - Production F3 app
- `f3-app2-client` - Secondary F3 app
- `auth-provider-local` - Local auth provider
- `auth-provider-prod` - Production auth provider

## Deployment

The application is configured for deployment on Firebase App Hosting:

1. **Configure secrets** in Google Cloud Secret Manager
2. **Update `apphosting.yaml`** with your configuration
3. **Deploy** using Firebase CLI

Environment variables are automatically loaded from Google Cloud Secret Manager in production.

## API Endpoints

### Authentication

- `POST /api/auth/signin` - Sign in with email
- `POST /api/verify-email` - Verify email code
- `POST /api/onboarding` - Complete user onboarding
- `GET /api/session` - Get current session

### OAuth 2.0

- `GET /api/oauth/authorize` - OAuth authorization
- `POST /api/oauth/token` - Token exchange
- `GET /api/oauth/userinfo` - User information

## Security Features

- **Email verification** required for all sign-ins
- **Secure session management** with JWT tokens
- **CSRF protection** built into NextAuth
- **Secure cookies** with proper domain and security settings
- **OAuth 2.0 compliance** with PKCE support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is proprietary to F3 Nation.
