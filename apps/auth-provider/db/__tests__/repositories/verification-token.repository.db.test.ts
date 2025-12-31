import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import type { VerificationTokenInsert } from '@/db/types';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function createVerificationTokenData(
  identifier: string,
  overrides: Partial<VerificationTokenInsert> = {}
): VerificationTokenInsert {
  return {
    identifier,
    token: generateToken(),
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    ...overrides,
  };
}

function createExpiredVerificationTokenData(
  identifier: string,
  overrides: Partial<VerificationTokenInsert> = {}
): VerificationTokenInsert {
  return createVerificationTokenData(identifier, {
    expires: new Date(Date.now() - 60 * 1000), // 1 minute ago
    ...overrides,
  });
}

describe('VerificationTokenRepository', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('create', () => {
    it('should create a verification token and return entity', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const tokenData = createVerificationTokenData(identifier);

      const token = await repos.verificationTokens.create(tokenData);

      expect(token).toBeDefined();
      expect(token.identifier).toBe(identifier);
      expect(token.token).toBe(tokenData.token);
      expect(token.expires).toBeDefined();
    });

    it('should allow multiple tokens for the same identifier', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';

      const token1 = await repos.verificationTokens.create(createVerificationTokenData(identifier));
      const token2 = await repos.verificationTokens.create(createVerificationTokenData(identifier));

      expect(token1.token).not.toBe(token2.token);
      expect(token1.identifier).toBe(token2.identifier);
    });

    it('should create token with custom expiration', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const customExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const tokenData = createVerificationTokenData(identifier, { expires: customExpires });

      const token = await repos.verificationTokens.create(tokenData);

      expect(token.expires.getTime()).toBe(customExpires.getTime());
    });
  });

  describe('find', () => {
    it('should find a verification token by identifier and token', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const tokenData = createVerificationTokenData(identifier);
      await repos.verificationTokens.create(tokenData);

      const found = await repos.verificationTokens.find(identifier, tokenData.token);

      expect(found).toBeDefined();
      expect(found?.identifier).toBe(identifier);
      expect(found?.token).toBe(tokenData.token);
    });

    it('should return null for non-existent identifier', async () => {
      const repos = getTestRepositories();
      const tokenData = createVerificationTokenData('test@example.com');
      await repos.verificationTokens.create(tokenData);

      const found = await repos.verificationTokens.find('other@example.com', tokenData.token);

      expect(found).toBeNull();
    });

    it('should return null for non-existent token', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const tokenData = createVerificationTokenData(identifier);
      await repos.verificationTokens.create(tokenData);

      const found = await repos.verificationTokens.find(identifier, 'wrong-token');

      expect(found).toBeNull();
    });

    it('should return null when neither identifier nor token match', async () => {
      const repos = getTestRepositories();

      const found = await repos.verificationTokens.find('nonexistent@example.com', 'wrong-token');

      expect(found).toBeNull();
    });

    it('should find expired tokens (expiration check done elsewhere)', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const tokenData = createExpiredVerificationTokenData(identifier);
      await repos.verificationTokens.create(tokenData);

      const found = await repos.verificationTokens.find(identifier, tokenData.token);

      expect(found).toBeDefined();
    });
  });

  describe('findByIdentifier', () => {
    it('should find all verification tokens for an identifier', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';

      await repos.verificationTokens.create(createVerificationTokenData(identifier));
      await repos.verificationTokens.create(createVerificationTokenData(identifier));
      await repos.verificationTokens.create(createVerificationTokenData(identifier));

      const tokens = await repos.verificationTokens.findByIdentifier(identifier);

      expect(tokens).toHaveLength(3);
      tokens.forEach(token => {
        expect(token.identifier).toBe(identifier);
      });
    });

    it('should return empty array for non-existent identifier', async () => {
      const repos = getTestRepositories();

      const tokens = await repos.verificationTokens.findByIdentifier('nonexistent@example.com');

      expect(tokens).toHaveLength(0);
    });

    it('should only return tokens for the specified identifier', async () => {
      const repos = getTestRepositories();
      const identifier1 = 'user1@example.com';
      const identifier2 = 'user2@example.com';

      await repos.verificationTokens.create(createVerificationTokenData(identifier1));
      await repos.verificationTokens.create(createVerificationTokenData(identifier1));
      await repos.verificationTokens.create(createVerificationTokenData(identifier2));

      const tokens = await repos.verificationTokens.findByIdentifier(identifier1);

      expect(tokens).toHaveLength(2);
      tokens.forEach(token => {
        expect(token.identifier).toBe(identifier1);
      });
    });
  });

  describe('delete', () => {
    it('should delete a verification token and return the deleted token', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const tokenData = createVerificationTokenData(identifier);
      await repos.verificationTokens.create(tokenData);

      const deleted = await repos.verificationTokens.delete(identifier, tokenData.token);

      expect(deleted).toBeDefined();
      expect(deleted?.identifier).toBe(identifier);
      expect(deleted?.token).toBe(tokenData.token);

      const found = await repos.verificationTokens.find(identifier, tokenData.token);
      expect(found).toBeNull();
    });

    it('should return null when deleting non-existent token', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.verificationTokens.delete(
        'nonexistent@example.com',
        'wrong-token'
      );

      expect(deleted).toBeNull();
    });

    it('should only delete the specific token when multiple exist for identifier', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      const tokenData1 = createVerificationTokenData(identifier);
      const tokenData2 = createVerificationTokenData(identifier);
      await repos.verificationTokens.create(tokenData1);
      await repos.verificationTokens.create(tokenData2);

      await repos.verificationTokens.delete(identifier, tokenData1.token);

      const found1 = await repos.verificationTokens.find(identifier, tokenData1.token);
      const found2 = await repos.verificationTokens.find(identifier, tokenData2.token);

      expect(found1).toBeNull();
      expect(found2).toBeDefined();
    });
  });

  describe('deleteByIdentifier', () => {
    it('should delete all verification tokens for an identifier', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';

      await repos.verificationTokens.create(createVerificationTokenData(identifier));
      await repos.verificationTokens.create(createVerificationTokenData(identifier));
      await repos.verificationTokens.create(createVerificationTokenData(identifier));

      const deletedCount = await repos.verificationTokens.deleteByIdentifier(identifier);

      expect(deletedCount).toBe(3);

      const tokens = await repos.verificationTokens.findByIdentifier(identifier);
      expect(tokens).toHaveLength(0);
    });

    it('should return 0 when identifier has no tokens', async () => {
      const repos = getTestRepositories();

      const deletedCount =
        await repos.verificationTokens.deleteByIdentifier('nonexistent@example.com');

      expect(deletedCount).toBe(0);
    });

    it('should only delete tokens for the specified identifier', async () => {
      const repos = getTestRepositories();
      const identifier1 = 'user1@example.com';
      const identifier2 = 'user2@example.com';

      await repos.verificationTokens.create(createVerificationTokenData(identifier1));
      await repos.verificationTokens.create(createVerificationTokenData(identifier1));
      await repos.verificationTokens.create(createVerificationTokenData(identifier2));

      await repos.verificationTokens.deleteByIdentifier(identifier1);

      const tokens1 = await repos.verificationTokens.findByIdentifier(identifier1);
      const tokens2 = await repos.verificationTokens.findByIdentifier(identifier2);

      expect(tokens1).toHaveLength(0);
      expect(tokens2).toHaveLength(1);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired verification tokens', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';

      await repos.verificationTokens.create(createExpiredVerificationTokenData(identifier));
      await repos.verificationTokens.create(createExpiredVerificationTokenData(identifier));
      const validTokenData = createVerificationTokenData(identifier);
      await repos.verificationTokens.create(validTokenData);

      const deletedCount = await repos.verificationTokens.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.verificationTokens.find(identifier, validTokenData.token);
      expect(found).toBeDefined();
    });

    it('should return 0 when no expired tokens exist', async () => {
      const repos = getTestRepositories();
      const identifier = 'test@example.com';
      await repos.verificationTokens.create(createVerificationTokenData(identifier));

      const deletedCount = await repos.verificationTokens.deleteExpired();

      expect(deletedCount).toBe(0);
    });

    it('should delete expired tokens across multiple identifiers', async () => {
      const repos = getTestRepositories();

      await repos.verificationTokens.create(
        createExpiredVerificationTokenData('user1@example.com')
      );
      await repos.verificationTokens.create(
        createExpiredVerificationTokenData('user2@example.com')
      );
      const validTokenData = createVerificationTokenData('user3@example.com');
      await repos.verificationTokens.create(validTokenData);

      const deletedCount = await repos.verificationTokens.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.verificationTokens.find('user3@example.com', validTokenData.token);
      expect(found).toBeDefined();
    });
  });
});
