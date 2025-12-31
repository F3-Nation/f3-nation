import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  createUserData,
  createOAuthClientData,
  resetUserCounter,
  resetOAuthClientCounter,
} from '@/test/utils/factories';
import type { OAuthAuthorizationCodeInsert } from '@/db/types';

function generateAuthCode(): string {
  return crypto.randomBytes(32).toString('hex');
}

function createAuthCodeData(
  clientId: string,
  userId: number,
  overrides: Partial<OAuthAuthorizationCodeInsert> = {}
): OAuthAuthorizationCodeInsert {
  return {
    code: generateAuthCode(),
    clientId,
    userId,
    redirectUri: 'http://localhost:3001/callback',
    scopes: 'openid profile email',
    codeChallenge: null,
    codeChallengeMethod: null,
    expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    ...overrides,
  };
}

function createExpiredAuthCodeData(
  clientId: string,
  userId: number,
  overrides: Partial<OAuthAuthorizationCodeInsert> = {}
): OAuthAuthorizationCodeInsert {
  return createAuthCodeData(clientId, userId, {
    expires: new Date(Date.now() - 60 * 1000), // 1 minute ago
    ...overrides,
  });
}

describe('OAuthAuthorizationCodeRepository', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetUserCounter();
    resetOAuthClientCounter();
  });

  describe('create', () => {
    it('should create an authorization code and return entity', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createAuthCodeData(client.id, user.id);

      const authCode = await repos.oauthAuthorizationCodes.create(authCodeData);

      expect(authCode).toBeDefined();
      expect(authCode.code).toBe(authCodeData.code);
      expect(authCode.clientId).toBe(client.id);
      expect(authCode.userId).toBe(user.id);
      expect(authCode.redirectUri).toBe(authCodeData.redirectUri);
      expect(authCode.scopes).toBe('openid profile email');
      expect(authCode.createdAt).toBeDefined();
    });

    it('should create an authorization code with PKCE', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const codeChallenge = crypto.randomBytes(32).toString('base64url');
      const authCodeData = createAuthCodeData(client.id, user.id, {
        codeChallenge,
        codeChallengeMethod: 'S256',
      });

      const authCode = await repos.oauthAuthorizationCodes.create(authCodeData);

      expect(authCode.codeChallenge).toBe(codeChallenge);
      expect(authCode.codeChallengeMethod).toBe('S256');
    });

    it('should throw error when creating with non-existent client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const authCodeData = createAuthCodeData('non-existent-client', user.id);

      await expect(repos.oauthAuthorizationCodes.create(authCodeData)).rejects.toThrow();
    });

    it('should throw error when creating with non-existent user', async () => {
      const repos = getTestRepositories();
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createAuthCodeData(client.id, 999999);

      await expect(repos.oauthAuthorizationCodes.create(authCodeData)).rejects.toThrow();
    });
  });

  describe('findByCode', () => {
    it('should find an authorization code', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createAuthCodeData(client.id, user.id);
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const found = await repos.oauthAuthorizationCodes.findByCode(authCodeData.code);

      expect(found).toBeDefined();
      expect(found?.code).toBe(authCodeData.code);
      expect(found?.clientId).toBe(client.id);
    });

    it('should return null for non-existent code', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthAuthorizationCodes.findByCode('non-existent-code');

      expect(found).toBeNull();
    });

    it('should find expired codes (expiration check is done elsewhere)', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createExpiredAuthCodeData(client.id, user.id);
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const found = await repos.oauthAuthorizationCodes.findByCode(authCodeData.code);

      expect(found).toBeDefined();
    });
  });

  describe('findValid', () => {
    it('should find a valid authorization code', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const redirectUri = 'http://localhost:3001/callback';
      const authCodeData = createAuthCodeData(client.id, user.id, { redirectUri });
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const found = await repos.oauthAuthorizationCodes.findValid(
        authCodeData.code,
        client.id,
        redirectUri
      );

      expect(found).toBeDefined();
      expect(found?.code).toBe(authCodeData.code);
    });

    it('should return null for expired code', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const redirectUri = 'http://localhost:3001/callback';
      const authCodeData = createExpiredAuthCodeData(client.id, user.id, { redirectUri });
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const found = await repos.oauthAuthorizationCodes.findValid(
        authCodeData.code,
        client.id,
        redirectUri
      );

      expect(found).toBeNull();
    });

    it('should return null for wrong client ID', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const redirectUri = 'http://localhost:3001/callback';
      const authCodeData = createAuthCodeData(client.id, user.id, { redirectUri });
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const found = await repos.oauthAuthorizationCodes.findValid(
        authCodeData.code,
        'wrong-client-id',
        redirectUri
      );

      expect(found).toBeNull();
    });

    it('should return null for wrong redirect URI', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const redirectUri = 'http://localhost:3001/callback';
      const authCodeData = createAuthCodeData(client.id, user.id, { redirectUri });
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const found = await repos.oauthAuthorizationCodes.findValid(
        authCodeData.code,
        client.id,
        'http://wrong-redirect.com/callback'
      );

      expect(found).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an authorization code and return true', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createAuthCodeData(client.id, user.id);
      await repos.oauthAuthorizationCodes.create(authCodeData);

      const deleted = await repos.oauthAuthorizationCodes.delete(authCodeData.code);

      expect(deleted).toBe(true);

      const found = await repos.oauthAuthorizationCodes.findByCode(authCodeData.code);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent code', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.oauthAuthorizationCodes.delete('non-existent-code');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteByClientId', () => {
    it('should delete all authorization codes for a client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client1 = await repos.oauthClients.create(createOAuthClientData());
      const client2 = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAuthorizationCodes.create(createAuthCodeData(client1.id, user.id));
      await repos.oauthAuthorizationCodes.create(createAuthCodeData(client1.id, user.id));
      const code3 = await repos.oauthAuthorizationCodes.create(
        createAuthCodeData(client2.id, user.id)
      );

      const deletedCount = await repos.oauthAuthorizationCodes.deleteByClientId(client1.id);

      expect(deletedCount).toBe(2);

      const found = await repos.oauthAuthorizationCodes.findByCode(code3.code);
      expect(found).toBeDefined();
    });

    it('should return 0 when client has no codes', async () => {
      const repos = getTestRepositories();

      const deletedCount = await repos.oauthAuthorizationCodes.deleteByClientId('non-existent');

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all authorization codes for a user', async () => {
      const repos = getTestRepositories();
      const user1 = await repos.users.create(createUserData());
      const user2 = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAuthorizationCodes.create(createAuthCodeData(client.id, user1.id));
      await repos.oauthAuthorizationCodes.create(createAuthCodeData(client.id, user1.id));
      const code3 = await repos.oauthAuthorizationCodes.create(
        createAuthCodeData(client.id, user2.id)
      );

      const deletedCount = await repos.oauthAuthorizationCodes.deleteByUserId(user1.id);

      expect(deletedCount).toBe(2);

      const found = await repos.oauthAuthorizationCodes.findByCode(code3.code);
      expect(found).toBeDefined();
    });

    it('should return 0 when user has no codes', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const deletedCount = await repos.oauthAuthorizationCodes.deleteByUserId(user.id);

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired authorization codes', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAuthorizationCodes.create(createExpiredAuthCodeData(client.id, user.id));
      await repos.oauthAuthorizationCodes.create(createExpiredAuthCodeData(client.id, user.id));
      const validCode = await repos.oauthAuthorizationCodes.create(
        createAuthCodeData(client.id, user.id)
      );

      const deletedCount = await repos.oauthAuthorizationCodes.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.oauthAuthorizationCodes.findByCode(validCode.code);
      expect(found).toBeDefined();
    });

    it('should return 0 when no expired codes exist', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      await repos.oauthAuthorizationCodes.create(createAuthCodeData(client.id, user.id));

      const deletedCount = await repos.oauthAuthorizationCodes.deleteExpired();

      expect(deletedCount).toBe(0);
    });
  });

  describe('cascade delete', () => {
    it('should delete authorization codes when client is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createAuthCodeData(client.id, user.id);
      await repos.oauthAuthorizationCodes.create(authCodeData);

      await repos.oauthClients.delete(client.id);

      const found = await repos.oauthAuthorizationCodes.findByCode(authCodeData.code);
      expect(found).toBeNull();
    });

    it('should delete authorization codes when user is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const authCodeData = createAuthCodeData(client.id, user.id);
      await repos.oauthAuthorizationCodes.create(authCodeData);

      await repos.users.delete(user.id);

      const found = await repos.oauthAuthorizationCodes.findByCode(authCodeData.code);
      expect(found).toBeNull();
    });
  });
});
