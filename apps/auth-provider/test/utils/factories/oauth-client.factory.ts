import crypto from 'crypto';
import type { OAuthClient, OAuthClientInsert } from '@/db/types/oauth-client';

let clientCounter = 0;

/**
 * Generate a unique client ID.
 */
function generateClientId(): string {
  return `test-client-${++clientCounter}-${Date.now()}`;
}

/**
 * Generate a random client secret.
 */
function generateClientSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate OAuth client data for inserting into the database.
 */
export function createOAuthClientData(
  overrides: Partial<OAuthClientInsert> = {}
): OAuthClientInsert {
  const clientId = generateClientId();
  return {
    id: clientId,
    name: `Test Client ${clientCounter}`,
    clientSecret: generateClientSecret(),
    redirectUris: JSON.stringify(['http://localhost:3001/callback']),
    allowedOrigin: 'http://localhost:3001',
    scopes: 'openid profile email',
    isActive: true,
    ...overrides,
  };
}

/**
 * Create a mock OAuthClient entity for unit tests.
 */
export function createMockOAuthClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  clientCounter++;
  return {
    id: `mock-client-${clientCounter}`,
    name: `Mock Client ${clientCounter}`,
    clientSecret: generateClientSecret(),
    redirectUris: JSON.stringify(['http://localhost:3001/callback']),
    allowedOrigin: 'http://localhost:3001',
    scopes: 'openid profile email',
    createdAt: new Date(),
    isActive: true,
    ...overrides,
  };
}

/**
 * Create OAuth client data with multiple redirect URIs.
 */
export function createOAuthClientDataWithMultipleRedirects(
  redirectUris: string[],
  overrides: Partial<OAuthClientInsert> = {}
): OAuthClientInsert {
  return createOAuthClientData({
    redirectUris: JSON.stringify(redirectUris),
    ...overrides,
  });
}

/**
 * Reset the client counter (useful in beforeEach hooks).
 */
export function resetOAuthClientCounter(): void {
  clientCounter = 0;
}
