import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DatabaseClient } from '@/db/client';
import { createRepositories, Repositories } from '@/db/repositories';

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool | null = null;
let dbClient: DatabaseClient | null = null;
let repositories: Repositories | null = null;

/**
 * Start a PostgreSQL test container and initialize the database schema.
 * Call this once in beforeAll() for database tests.
 */
export async function setupTestDatabase(): Promise<void> {
  // Start PostgreSQL container
  container = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_password')
    .start();

  // Create pool with container connection string
  pool = new Pool({
    connectionString: container.getConnectionUri(),
  });

  // Create database client
  dbClient = new DatabaseClient(pool);

  // Run migrations to set up schema
  await runMigrations(pool);

  // Initialize repositories
  repositories = createRepositories(dbClient);
}

/**
 * Run database migrations to set up the schema
 */
async function runMigrations(pool: Pool): Promise<void> {
  // Create public schema (usually exists by default, but ensure it)
  await pool.query('CREATE SCHEMA IF NOT EXISTS public');

  // Create auth schema
  await pool.query('CREATE SCHEMA IF NOT EXISTS auth');

  // Create public.users table (external table in production, we create it for tests)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id SERIAL PRIMARY KEY,
      f3_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      home_region_id INTEGER,
      avatar_url TEXT,
      meta TEXT,
      created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      emergency_contact TEXT,
      emergency_phone TEXT,
      emergency_notes TEXT,
      email_verified TIMESTAMP WITH TIME ZONE,
      status TEXT DEFAULT 'active'
    )
  `);

  // Create auth.email_mfa_codes table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.email_mfa_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      consumed_at TIMESTAMP WITH TIME ZONE,
      attempt_count INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )
  `);

  // Create auth.oauth_clients table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.oauth_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      allowed_origin TEXT NOT NULL,
      scopes TEXT DEFAULT 'openid profile email' NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      is_active BOOLEAN DEFAULT true NOT NULL
    )
  `);

  // Create auth.oauth_authorization_codes table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.oauth_authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES auth.oauth_clients(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      scopes TEXT NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT,
      expires TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )
  `);

  // Create auth.oauth_access_tokens table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.oauth_access_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES auth.oauth_clients(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      scopes TEXT NOT NULL,
      expires TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )
  `);

  // Create auth.oauth_refresh_tokens table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.oauth_refresh_tokens (
      token TEXT PRIMARY KEY,
      access_token TEXT NOT NULL REFERENCES auth.oauth_access_tokens(token) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES auth.oauth_clients(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      expires TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )
  `);

  // Create auth.sessions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.sessions (
      session_token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      expires TIMESTAMP WITH TIME ZONE NOT NULL
    )
  `);

  // Create auth.user_profiles table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
      hospital_name TEXT,
      onboarding_completed BOOLEAN DEFAULT false NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    )
  `);

  // Create auth.verification_tokens table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.verification_tokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires TIMESTAMP WITH TIME ZONE NOT NULL,
      PRIMARY KEY (identifier, token)
    )
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS email_mfa_code_email_idx ON auth.email_mfa_codes(email)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS email_mfa_code_expires_idx ON auth.email_mfa_codes(expires_at)
  `);
}

/**
 * Clean up test data by truncating all tables.
 * Call this in beforeEach() or afterEach() to reset state between tests.
 */
export async function cleanupTestData(): Promise<void> {
  if (!pool) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }

  // Truncate tables in reverse order of dependencies
  await pool.query('TRUNCATE auth.oauth_refresh_tokens CASCADE');
  await pool.query('TRUNCATE auth.oauth_access_tokens CASCADE');
  await pool.query('TRUNCATE auth.oauth_authorization_codes CASCADE');
  await pool.query('TRUNCATE auth.oauth_clients CASCADE');
  await pool.query('TRUNCATE auth.sessions CASCADE');
  await pool.query('TRUNCATE auth.user_profiles CASCADE');
  await pool.query('TRUNCATE auth.verification_tokens CASCADE');
  await pool.query('TRUNCATE auth.email_mfa_codes CASCADE');
  await pool.query('TRUNCATE public.users CASCADE');

  // Reset sequences
  await pool.query('ALTER SEQUENCE public.users_id_seq RESTART WITH 1');
}

/**
 * Tear down the test database and stop the container.
 * Call this in afterAll() for database tests.
 */
export async function teardownTestDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }

  if (container) {
    await container.stop();
    container = null;
  }

  dbClient = null;
  repositories = null;
}

/**
 * Get the test database client.
 * Must call setupTestDatabase() first.
 */
export function getTestDbClient(): DatabaseClient {
  if (!dbClient) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return dbClient;
}

/**
 * Get the test repositories.
 * Must call setupTestDatabase() first.
 */
export function getTestRepositories(): Repositories {
  if (!repositories) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return repositories;
}

/**
 * Get the underlying pool for direct SQL queries in tests.
 * Must call setupTestDatabase() first.
 */
export function getTestPool(): Pool {
  if (!pool) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return pool;
}

/**
 * Check if the test database is initialized.
 */
export function isTestDatabaseInitialized(): boolean {
  return container !== null && pool !== null;
}
