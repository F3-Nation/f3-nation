/**
 * Database mock utilities for integration tests.
 *
 * This file provides a way to mock the @/db module with test repositories.
 * The repositories are stored in globalThis so they can be accessed by the mock
 * even after module resets.
 */

import type { Repositories } from '@/db/repositories';

// Global storage for test repositories
declare global {
  // eslint-disable-next-line no-var
  var __testDbRepositories: Repositories | undefined;
}

/**
 * Store repositories in global scope for mock access
 */
export function setGlobalRepositories(repos: Repositories): void {
  globalThis.__testDbRepositories = repos;
}

/**
 * Clear global repositories
 */
export function clearGlobalRepositories(): void {
  globalThis.__testDbRepositories = undefined;
}

/**
 * Get global repositories (called by mock)
 */
export function getGlobalRepositories(): Repositories | undefined {
  return globalThis.__testDbRepositories;
}

/**
 * Create the mock factory for @/db
 * This should be used with vi.mock('@/db', createDbMockFactory())
 */
export function createDbMockFactory() {
  return () => ({
    get userRepository() {
      return globalThis.__testDbRepositories?.users;
    },
    get userProfileRepository() {
      return globalThis.__testDbRepositories?.userProfiles;
    },
    get sessionRepository() {
      return globalThis.__testDbRepositories?.sessions;
    },
    get verificationTokenRepository() {
      return globalThis.__testDbRepositories?.verificationTokens;
    },
    get oauthClientRepository() {
      return globalThis.__testDbRepositories?.oauthClients;
    },
    get oauthAuthorizationCodeRepository() {
      return globalThis.__testDbRepositories?.oauthAuthorizationCodes;
    },
    get oauthAccessTokenRepository() {
      return globalThis.__testDbRepositories?.oauthAccessTokens;
    },
    get oauthRefreshTokenRepository() {
      return globalThis.__testDbRepositories?.oauthRefreshTokens;
    },
    get emailMfaCodeRepository() {
      return globalThis.__testDbRepositories?.emailMfaCodes;
    },
    // Also provide pool and dbClient as undefined (they shouldn't be used in tests)
    pool: undefined,
    dbClient: undefined,
    // Provide a no-op for ensureSequenceSynced
    ensureSequenceSynced: async () => {},
    // Provide getRepositories for the adapter
    getRepositories: () => globalThis.__testDbRepositories,
  });
}
