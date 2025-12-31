import { Pool } from 'pg';
import { DatabaseClient } from './client';
import { initializeRepositories, getRepositories, getDbClient } from './repositories';

// Re-export types
export * from './types';
export { DatabaseClient } from './client';
export {
  getRepositories,
  getDbClient,
  createRepositories,
  type Repositories,
} from './repositories';

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL environment variable is not set. Database operations will fail.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Export pool for raw SQL queries when needed (for migration scripts)
export { pool };

// Create and export the DatabaseClient instance
export const dbClient = new DatabaseClient(pool);

// Initialize repositories singleton
const repos = initializeRepositories(dbClient);

// Convenience exports for repositories
export const {
  users: userRepository,
  userProfiles: userProfileRepository,
  sessions: sessionRepository,
  verificationTokens: verificationTokenRepository,
  oauthClients: oauthClientRepository,
  oauthAuthorizationCodes: oauthAuthorizationCodeRepository,
  oauthAccessTokens: oauthAccessTokenRepository,
  oauthRefreshTokens: oauthRefreshTokenRepository,
  emailMfaCodes: emailMfaCodeRepository,
} = repos;

// Sync the users_id_seq to continue after the max existing ID
// This ensures new user inserts don't conflict with existing data
let sequenceSynced = false;
export async function ensureSequenceSynced(): Promise<void> {
  if (sequenceSynced) return;
  try {
    await dbClient.query(
      "SELECT setval('public.users_id_seq', COALESCE((SELECT MAX(id) FROM public.users), 0))"
    );
    sequenceSynced = true;
  } catch (error) {
    console.error('Failed to sync users_id_seq:', error);
  }
}
