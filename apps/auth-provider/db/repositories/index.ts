import { DatabaseClient } from '../client';
import { UserRepository } from './user.repository';
import { UserProfileRepository } from './user-profile.repository';
import { SessionRepository } from './session.repository';
import { VerificationTokenRepository } from './verification-token.repository';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthAuthorizationCodeRepository } from './oauth-authorization-code.repository';
import { OAuthAccessTokenRepository } from './oauth-access-token.repository';
import { OAuthRefreshTokenRepository } from './oauth-refresh-token.repository';
import { EmailMfaCodeRepository } from './email-mfa-code.repository';

// Re-export all repository classes
export { UserRepository } from './user.repository';
export { UserProfileRepository } from './user-profile.repository';
export { SessionRepository } from './session.repository';
export { VerificationTokenRepository } from './verification-token.repository';
export { OAuthClientRepository } from './oauth-client.repository';
export { OAuthAuthorizationCodeRepository } from './oauth-authorization-code.repository';
export { OAuthAccessTokenRepository } from './oauth-access-token.repository';
export { OAuthRefreshTokenRepository } from './oauth-refresh-token.repository';
export { EmailMfaCodeRepository } from './email-mfa-code.repository';

/**
 * Interface containing all repositories
 */
export interface Repositories {
  users: UserRepository;
  userProfiles: UserProfileRepository;
  sessions: SessionRepository;
  verificationTokens: VerificationTokenRepository;
  oauthClients: OAuthClientRepository;
  oauthAuthorizationCodes: OAuthAuthorizationCodeRepository;
  oauthAccessTokens: OAuthAccessTokenRepository;
  oauthRefreshTokens: OAuthRefreshTokenRepository;
  emailMfaCodes: EmailMfaCodeRepository;
}

/**
 * Create all repositories with a shared database client
 */
export function createRepositories(client: DatabaseClient): Repositories {
  return {
    users: new UserRepository(client),
    userProfiles: new UserProfileRepository(client),
    sessions: new SessionRepository(client),
    verificationTokens: new VerificationTokenRepository(client),
    oauthClients: new OAuthClientRepository(client),
    oauthAuthorizationCodes: new OAuthAuthorizationCodeRepository(client),
    oauthAccessTokens: new OAuthAccessTokenRepository(client),
    oauthRefreshTokens: new OAuthRefreshTokenRepository(client),
    emailMfaCodes: new EmailMfaCodeRepository(client),
  };
}

// Singleton instance - lazily initialized
let repositoriesInstance: Repositories | null = null;
let dbClientInstance: DatabaseClient | null = null;

/**
 * Get the singleton repositories instance
 * Must be initialized by calling initializeRepositories first
 */
export function getRepositories(): Repositories {
  if (!repositoriesInstance) {
    throw new Error('Repositories not initialized. Call initializeRepositories first.');
  }
  return repositoriesInstance;
}

/**
 * Get the singleton database client
 */
export function getDbClient(): DatabaseClient {
  if (!dbClientInstance) {
    throw new Error('Database client not initialized. Call initializeRepositories first.');
  }
  return dbClientInstance;
}

/**
 * Initialize the singleton repositories with a database client
 */
export function initializeRepositories(client: DatabaseClient): Repositories {
  dbClientInstance = client;
  repositoriesInstance = createRepositories(client);
  return repositoriesInstance;
}
