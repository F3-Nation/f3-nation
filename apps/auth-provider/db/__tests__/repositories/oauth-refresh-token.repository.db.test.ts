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
import type { OAuthRefreshTokenInsert, OAuthAccessTokenInsert } from '@/db/types';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function createAccessTokenData(
  clientId: string,
  userId: number,
  overrides: Partial<OAuthAccessTokenInsert> = {}
): OAuthAccessTokenInsert {
  return {
    token: generateToken(),
    clientId,
    userId,
    scopes: 'openid profile email',
    expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    ...overrides,
  };
}

function createRefreshTokenData(
  accessToken: string,
  clientId: string,
  userId: number,
  overrides: Partial<OAuthRefreshTokenInsert> = {}
): OAuthRefreshTokenInsert {
  return {
    token: generateToken(),
    accessToken,
    clientId,
    userId,
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    ...overrides,
  };
}

function createExpiredRefreshTokenData(
  accessToken: string,
  clientId: string,
  userId: number,
  overrides: Partial<OAuthRefreshTokenInsert> = {}
): OAuthRefreshTokenInsert {
  return createRefreshTokenData(accessToken, clientId, userId, {
    expires: new Date(Date.now() - 60 * 1000), // 1 minute ago
    ...overrides,
  });
}

describe('OAuthRefreshTokenRepository', () => {
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
    it('should create a refresh token and return entity', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);

      const refreshToken = await repos.oauthRefreshTokens.create(refreshTokenData);

      expect(refreshToken).toBeDefined();
      expect(refreshToken.token).toBe(refreshTokenData.token);
      expect(refreshToken.accessToken).toBe(accessToken.token);
      expect(refreshToken.clientId).toBe(client.id);
      expect(refreshToken.userId).toBe(user.id);
      expect(refreshToken.createdAt).toBeDefined();
    });

    it('should throw error when creating with non-existent access token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const refreshTokenData = createRefreshTokenData('non-existent-token', client.id, user.id);

      await expect(repos.oauthRefreshTokens.create(refreshTokenData)).rejects.toThrow();
    });

    it('should throw error when creating with non-existent client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(
        accessToken.token,
        'non-existent-client',
        user.id
      );

      await expect(repos.oauthRefreshTokens.create(refreshTokenData)).rejects.toThrow();
    });

    it('should throw error when creating with non-existent user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, 999999);

      await expect(repos.oauthRefreshTokens.create(refreshTokenData)).rejects.toThrow();
    });
  });

  describe('findByToken', () => {
    it('should find a refresh token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const found = await repos.oauthRefreshTokens.findByToken(refreshTokenData.token);

      expect(found).toBeDefined();
      expect(found?.token).toBe(refreshTokenData.token);
    });

    it('should return null for non-existent token', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthRefreshTokens.findByToken('non-existent-token');

      expect(found).toBeNull();
    });
  });

  describe('findValid', () => {
    it('should find a valid (non-expired) refresh token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const found = await repos.oauthRefreshTokens.findValid(refreshTokenData.token, client.id);

      expect(found).toBeDefined();
      expect(found?.token).toBe(refreshTokenData.token);
    });

    it('should return null for expired token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createExpiredRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const found = await repos.oauthRefreshTokens.findValid(refreshTokenData.token, client.id);

      expect(found).toBeNull();
    });

    it('should return null for wrong client ID', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const found = await repos.oauthRefreshTokens.findValid(
        refreshTokenData.token,
        'wrong-client-id'
      );

      expect(found).toBeNull();
    });
  });

  describe('findByAccessToken', () => {
    it('should find refresh token by access token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const found = await repos.oauthRefreshTokens.findByAccessToken(accessToken.token);

      expect(found).toBeDefined();
      expect(found?.accessToken).toBe(accessToken.token);
    });

    it('should return null when no refresh token exists for access token', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthRefreshTokens.findByAccessToken('non-existent-token');

      expect(found).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all refresh tokens for a user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      for (let i = 0; i < 3; i++) {
        const accessToken = await repos.oauthAccessTokens.create(
          createAccessTokenData(client.id, user.id)
        );
        await repos.oauthRefreshTokens.create(
          createRefreshTokenData(accessToken.token, client.id, user.id)
        );
      }

      const tokens = await repos.oauthRefreshTokens.findByUserId(user.id);

      expect(tokens).toHaveLength(3);
      tokens.forEach(token => {
        expect(token.userId).toBe(user.id);
      });
    });

    it('should return empty array for user with no tokens', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const tokens = await repos.oauthRefreshTokens.findByUserId(user.id);

      expect(tokens).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete a refresh token and return true', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const deleted = await repos.oauthRefreshTokens.delete(refreshTokenData.token);

      expect(deleted).toBe(true);

      const found = await repos.oauthRefreshTokens.findByToken(refreshTokenData.token);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent token', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.oauthRefreshTokens.delete('non-existent-token');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteByAccessToken', () => {
    it('should delete refresh token by access token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      const deleted = await repos.oauthRefreshTokens.deleteByAccessToken(accessToken.token);

      expect(deleted).toBe(true);

      const found = await repos.oauthRefreshTokens.findByToken(refreshTokenData.token);
      expect(found).toBeNull();
    });

    it('should return false when no refresh token exists for access token', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.oauthRefreshTokens.deleteByAccessToken('non-existent-token');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteByClientId', () => {
    it('should delete all refresh tokens for a client', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client1 = await repos.oauthClients.create(createOAuthClientData());
      const client2 = await repos.oauthClients.create(createOAuthClientData());

      // Create tokens for client1
      for (let i = 0; i < 2; i++) {
        const accessToken = await repos.oauthAccessTokens.create(
          createAccessTokenData(client1.id, user.id)
        );
        await repos.oauthRefreshTokens.create(
          createRefreshTokenData(accessToken.token, client1.id, user.id)
        );
      }

      // Create token for client2
      const accessToken3 = await repos.oauthAccessTokens.create(
        createAccessTokenData(client2.id, user.id)
      );
      const refreshToken3 = await repos.oauthRefreshTokens.create(
        createRefreshTokenData(accessToken3.token, client2.id, user.id)
      );

      const deletedCount = await repos.oauthRefreshTokens.deleteByClientId(client1.id);

      expect(deletedCount).toBe(2);

      const found = await repos.oauthRefreshTokens.findByToken(refreshToken3.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when client has no tokens', async () => {
      const repos = getTestRepositories();

      const deletedCount = await repos.oauthRefreshTokens.deleteByClientId('non-existent');

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all refresh tokens for a user', async () => {
      const repos = getTestRepositories();
      const user1 = await repos.users.create(createUserData());
      const user2 = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      // Create tokens for user1
      for (let i = 0; i < 2; i++) {
        const accessToken = await repos.oauthAccessTokens.create(
          createAccessTokenData(client.id, user1.id)
        );
        await repos.oauthRefreshTokens.create(
          createRefreshTokenData(accessToken.token, client.id, user1.id)
        );
      }

      // Create token for user2
      const accessToken3 = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user2.id)
      );
      const refreshToken3 = await repos.oauthRefreshTokens.create(
        createRefreshTokenData(accessToken3.token, client.id, user2.id)
      );

      const deletedCount = await repos.oauthRefreshTokens.deleteByUserId(user1.id);

      expect(deletedCount).toBe(2);

      const found = await repos.oauthRefreshTokens.findByToken(refreshToken3.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when user has no tokens', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const deletedCount = await repos.oauthRefreshTokens.deleteByUserId(user.id);

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired refresh tokens', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());

      // Create expired tokens
      for (let i = 0; i < 2; i++) {
        const accessToken = await repos.oauthAccessTokens.create(
          createAccessTokenData(client.id, user.id)
        );
        await repos.oauthRefreshTokens.create(
          createExpiredRefreshTokenData(accessToken.token, client.id, user.id)
        );
      }

      // Create valid token
      const validAccessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const validRefreshToken = await repos.oauthRefreshTokens.create(
        createRefreshTokenData(validAccessToken.token, client.id, user.id)
      );

      const deletedCount = await repos.oauthRefreshTokens.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.oauthRefreshTokens.findByToken(validRefreshToken.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when no expired tokens exist', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      await repos.oauthRefreshTokens.create(
        createRefreshTokenData(accessToken.token, client.id, user.id)
      );

      const deletedCount = await repos.oauthRefreshTokens.deleteExpired();

      expect(deletedCount).toBe(0);
    });
  });

  describe('cascade delete', () => {
    it('should delete refresh tokens when access token is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      await repos.oauthAccessTokens.delete(accessToken.token);

      const found = await repos.oauthRefreshTokens.findByToken(refreshTokenData.token);
      expect(found).toBeNull();
    });

    it('should delete refresh tokens when client is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      await repos.oauthClients.delete(client.id);

      const found = await repos.oauthRefreshTokens.findByToken(refreshTokenData.token);
      expect(found).toBeNull();
    });

    it('should delete refresh tokens when user is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const client = await repos.oauthClients.create(createOAuthClientData());
      const accessToken = await repos.oauthAccessTokens.create(
        createAccessTokenData(client.id, user.id)
      );
      const refreshTokenData = createRefreshTokenData(accessToken.token, client.id, user.id);
      await repos.oauthRefreshTokens.create(refreshTokenData);

      await repos.users.delete(user.id);

      const found = await repos.oauthRefreshTokens.findByToken(refreshTokenData.token);
      expect(found).toBeNull();
    });
  });
});
