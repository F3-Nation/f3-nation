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
import type { OAuthAccessTokenInsert } from '@/db/types';

function generateAccessToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function createAccessTokenData(
  clientId: string,
  userId: number,
  overrides: Partial<OAuthAccessTokenInsert> = {}
): OAuthAccessTokenInsert {
  return {
    token: generateAccessToken(),
    clientId,
    userId,
    scopes: 'openid profile email',
    expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    ...overrides,
  };
}

function createExpiredAccessTokenData(
  clientId: string,
  userId: number,
  overrides: Partial<OAuthAccessTokenInsert> = {}
): OAuthAccessTokenInsert {
  return createAccessTokenData(clientId, userId, {
    expires: new Date(Date.now() - 60 * 1000), // 1 minute ago
    ...overrides,
  });
}

describe('OAuthAccessTokenRepository', () => {
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
    it('should create an access token and return entity', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id);

      const token = await repos.oauthAccessTokens.create(tokenData);

      expect(token).toBeDefined();
      expect(token.token).toBe(tokenData.token);
      expect(token.clientId).toBe(client.id);
      expect(token.userId).toBe(user.id);
      expect(token.scopes).toBe('openid profile email');
      expect(token.createdAt).toBeDefined();
    });

    it('should create a token with custom scopes', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id, {
        scopes: 'openid',
      });

      const token = await repos.oauthAccessTokens.create(tokenData);

      expect(token.scopes).toBe('openid');
    });

    it('should throw error when creating with non-existent client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const tokenData = createAccessTokenData('non-existent-client', user.id);

      await expect(repos.oauthAccessTokens.create(tokenData)).rejects.toThrow();
    });

    it('should throw error when creating with non-existent user', async () => {
      const repos = getTestRepositories();
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, 999999);

      await expect(repos.oauthAccessTokens.create(tokenData)).rejects.toThrow();
    });

    it('should allow multiple tokens for same user and client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      const token1 = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const token2 = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );

      expect(token1.token).not.toBe(token2.token);
    });
  });

  describe('findByToken', () => {
    it('should find an access token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id);
      await repos.oauthAccessTokens.create(tokenData);

      const found = await repos.oauthAccessTokens.findByToken(tokenData.token);

      expect(found).toBeDefined();
      expect(found?.token).toBe(tokenData.token);
      expect(found?.clientId).toBe(client.id);
    });

    it('should return null for non-existent token', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthAccessTokens.findByToken('non-existent-token');

      expect(found).toBeNull();
    });
  });

  describe('findValid', () => {
    it('should find a valid (non-expired) access token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id);
      await repos.oauthAccessTokens.create(tokenData);

      const found = await repos.oauthAccessTokens.findValid(tokenData.token);

      expect(found).toBeDefined();
      expect(found?.token).toBe(tokenData.token);
    });

    it('should return null for expired token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createExpiredAccessTokenData(client.id, user.id);
      await repos.oauthAccessTokens.create(tokenData);

      const found = await repos.oauthAccessTokens.findValid(tokenData.token);

      expect(found).toBeNull();
    });

    it('should return null for non-existent token', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthAccessTokens.findValid('non-existent-token');

      expect(found).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all access tokens for a user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user.id));
      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user.id));
      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user.id));

      const tokens = await repos.oauthAccessTokens.findByUserId(user.id);

      expect(tokens).toHaveLength(3);
      tokens.forEach(token => {
        expect(token.userId).toBe(user.id);
      });
    });

    it('should return empty array for user with no tokens', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const tokens = await repos.oauthAccessTokens.findByUserId(user.id);

      expect(tokens).toHaveLength(0);
    });

    it('should only return tokens for the specified user', async () => {
      const repos = getTestRepositories();
      const user1 = await repos.users.create(createUserData());
      const user2 = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user1.id));
      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user1.id));
      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user2.id));

      const tokens = await repos.oauthAccessTokens.findByUserId(user1.id);

      expect(tokens).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should delete an access token and return true', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id);
      await repos.oauthAccessTokens.create(tokenData);

      const deleted = await repos.oauthAccessTokens.delete(tokenData.token);

      expect(deleted).toBe(true);

      const found = await repos.oauthAccessTokens.findByToken(tokenData.token);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent token', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.oauthAccessTokens.delete('non-existent-token');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteByClientId', () => {
    it('should delete all access tokens for a client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client1 = await repos.oauthClients.create(createOAuthClientData());
      const client2 = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAccessTokens.create(createAccessTokenData(client1.id, user.id));
      await repos.oauthAccessTokens.create(createAccessTokenData(client1.id, user.id));
      const token3 = await repos.oauthAccessTokens.create(
        createAccessTokenData(client2.id, user.id)
      );

      const deletedCount = await repos.oauthAccessTokens.deleteByClientId(client1.id);

      expect(deletedCount).toBe(2);

      const found = await repos.oauthAccessTokens.findByToken(token3.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when client has no tokens', async () => {
      const repos = getTestRepositories();

      const deletedCount = await repos.oauthAccessTokens.deleteByClientId('non-existent');

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all access tokens for a user', async () => {
      const repos = getTestRepositories();
      const user1 = await repos.users.create(createUserData());
      const user2 = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user1.id));
      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user1.id));
      const token3 = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user2.id)
      );

      const deletedCount = await repos.oauthAccessTokens.deleteByUserId(user1.id);

      expect(deletedCount).toBe(2);

      const found = await repos.oauthAccessTokens.findByToken(token3.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when user has no tokens', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const deletedCount = await repos.oauthAccessTokens.deleteByUserId(user.id);

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired access tokens', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      await repos.oauthAccessTokens.create(createExpiredAccessTokenData(client.id, user.id));
      await repos.oauthAccessTokens.create(createExpiredAccessTokenData(client.id, user.id));
      const validToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );

      const deletedCount = await repos.oauthAccessTokens.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.oauthAccessTokens.findByToken(validToken.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when no expired tokens exist', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      await repos.oauthAccessTokens.create(createAccessTokenData(client.id, user.id));

      const deletedCount = await repos.oauthAccessTokens.deleteExpired();

      expect(deletedCount).toBe(0);
    });
  });

  describe('cascade delete', () => {
    it('should delete access tokens when client is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id);
      await repos.oauthAccessTokens.create(tokenData);

      await repos.oauthClients.delete(client.id);

      const found = await repos.oauthAccessTokens.findByToken(tokenData.token);
      expect(found).toBeNull();
    });

    it('should delete access tokens when user is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const tokenData = createAccessTokenData(client.id, user.id);
      await repos.oauthAccessTokens.create(tokenData);

      await repos.users.delete(user.id);

      const found = await repos.oauthAccessTokens.findByToken(tokenData.token);
      expect(found).toBeNull();
    });
  });
});
