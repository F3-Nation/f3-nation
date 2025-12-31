import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  createMfaCodeData,
  createExpiredMfaCodeData,
  resetMfaCodeCounter,
} from '@/test/utils/factories';

describe('EmailMfaCodeRepository', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetMfaCodeCounter();
  });

  describe('create', () => {
    it('should create an MFA code and return entity', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);

      const mfaCode = await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: mfaData.attemptCount,
      });

      expect(mfaCode).toBeDefined();
      expect(mfaCode.id).toBe(mfaData.id);
      expect(mfaCode.email).toBe(email);
      expect(mfaCode.codeHash).toBe(mfaData.codeHash);
      expect(mfaCode.consumedAt).toBeNull();
      expect(mfaCode.attemptCount).toBe(0);
      expect(mfaCode.createdAt).toBeDefined();
    });

    it('should allow multiple MFA codes for the same email', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData1 = createMfaCodeData(email);
      const mfaData2 = createMfaCodeData(email);

      const code1 = await repos.emailMfaCodes.create({
        id: mfaData1.id,
        email: mfaData1.email,
        codeHash: mfaData1.codeHash,
        expiresAt: mfaData1.expiresAt,
        attemptCount: 0,
      });
      const code2 = await repos.emailMfaCodes.create({
        id: mfaData2.id,
        email: mfaData2.email,
        codeHash: mfaData2.codeHash,
        expiresAt: mfaData2.expiresAt,
        attemptCount: 0,
      });

      expect(code1.id).not.toBe(code2.id);
      expect(code1.email).toBe(code2.email);
    });
  });

  describe('findById', () => {
    it('should find an MFA code by ID', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const found = await repos.emailMfaCodes.findById(mfaData.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(mfaData.id);
      expect(found?.email).toBe(email);
    });

    it('should return null for non-existent ID', async () => {
      const repos = getTestRepositories();

      const found = await repos.emailMfaCodes.findById('non-existent-id');

      expect(found).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find all MFA codes for an email', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      for (let i = 0; i < 3; i++) {
        const mfaData = createMfaCodeData(email);
        await repos.emailMfaCodes.create({
          id: mfaData.id,
          email: mfaData.email,
          codeHash: mfaData.codeHash,
          expiresAt: mfaData.expiresAt,
          attemptCount: 0,
        });
      }

      const codes = await repos.emailMfaCodes.findByEmail(email);

      expect(codes).toHaveLength(3);
      codes.forEach(code => {
        expect(code.email).toBe(email);
      });
    });

    it('should return codes ordered by created_at DESC', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      const mfaData1 = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData1.id,
        email: mfaData1.email,
        codeHash: mfaData1.codeHash,
        expiresAt: mfaData1.expiresAt,
        attemptCount: 0,
      });

      // Small delay to ensure different created_at timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const mfaData2 = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData2.id,
        email: mfaData2.email,
        codeHash: mfaData2.codeHash,
        expiresAt: mfaData2.expiresAt,
        attemptCount: 0,
      });

      const codes = await repos.emailMfaCodes.findByEmail(email);

      expect(codes).toHaveLength(2);
      expect(codes[0].id).toBe(mfaData2.id); // Most recent first
    });

    it('should return empty array for email with no codes', async () => {
      const repos = getTestRepositories();

      const codes = await repos.emailMfaCodes.findByEmail('nonexistent@example.com');

      expect(codes).toHaveLength(0);
    });
  });

  describe('findLatestUnconsumed', () => {
    it('should find the latest unconsumed code for an email', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      const mfaData1 = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData1.id,
        email: mfaData1.email,
        codeHash: mfaData1.codeHash,
        expiresAt: mfaData1.expiresAt,
        attemptCount: 0,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const mfaData2 = createMfaCodeData(email);
      const latestCode = await repos.emailMfaCodes.create({
        id: mfaData2.id,
        email: mfaData2.email,
        codeHash: mfaData2.codeHash,
        expiresAt: mfaData2.expiresAt,
        attemptCount: 0,
      });

      const found = await repos.emailMfaCodes.findLatestUnconsumed(email);

      expect(found).toBeDefined();
      expect(found?.id).toBe(latestCode.id);
    });

    it('should return null when all codes are consumed', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);

      const code = await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      await repos.emailMfaCodes.markConsumed(code.id);

      const found = await repos.emailMfaCodes.findLatestUnconsumed(email);

      expect(found).toBeNull();
    });

    it('should return null when no codes exist', async () => {
      const repos = getTestRepositories();

      const found = await repos.emailMfaCodes.findLatestUnconsumed('nonexistent@example.com');

      expect(found).toBeNull();
    });

    it('should skip consumed codes and return latest unconsumed', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      const mfaData1 = createMfaCodeData(email);
      const oldCode = await repos.emailMfaCodes.create({
        id: mfaData1.id,
        email: mfaData1.email,
        codeHash: mfaData1.codeHash,
        expiresAt: mfaData1.expiresAt,
        attemptCount: 0,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const mfaData2 = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData2.id,
        email: mfaData2.email,
        codeHash: mfaData2.codeHash,
        expiresAt: mfaData2.expiresAt,
        attemptCount: 0,
      });

      // Consume the newer code
      await repos.emailMfaCodes.markConsumed(mfaData2.id);

      const found = await repos.emailMfaCodes.findLatestUnconsumed(email);

      expect(found).toBeDefined();
      expect(found?.id).toBe(oldCode.id);
    });
  });

  describe('update', () => {
    it('should update MFA code fields', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const consumedAt = new Date();
      const updated = await repos.emailMfaCodes.update(mfaData.id, {
        consumedAt,
        attemptCount: 5,
      });

      expect(updated).toBeDefined();
      expect(updated?.consumedAt?.getTime()).toBe(consumedAt.getTime());
      expect(updated?.attemptCount).toBe(5);
    });

    it('should return null when updating non-existent code', async () => {
      const repos = getTestRepositories();

      const updated = await repos.emailMfaCodes.update('non-existent-id', {
        attemptCount: 1,
      });

      expect(updated).toBeNull();
    });
  });

  describe('markConsumed', () => {
    it('should mark an MFA code as consumed', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const before = Date.now();
      const updated = await repos.emailMfaCodes.markConsumed(mfaData.id);
      const after = Date.now();

      expect(updated).toBeDefined();
      expect(updated?.consumedAt).toBeDefined();
      expect(updated?.consumedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(updated?.consumedAt!.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('incrementAttemptCount', () => {
    it('should increment the attempt count', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const updated1 = await repos.emailMfaCodes.incrementAttemptCount(mfaData.id);
      expect(updated1?.attemptCount).toBe(1);

      const updated2 = await repos.emailMfaCodes.incrementAttemptCount(mfaData.id);
      expect(updated2?.attemptCount).toBe(2);

      const updated3 = await repos.emailMfaCodes.incrementAttemptCount(mfaData.id);
      expect(updated3?.attemptCount).toBe(3);
    });

    it('should return null for non-existent code', async () => {
      const repos = getTestRepositories();

      const updated = await repos.emailMfaCodes.incrementAttemptCount('non-existent-id');

      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an MFA code and return true', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const deleted = await repos.emailMfaCodes.delete(mfaData.id);

      expect(deleted).toBe(true);

      const found = await repos.emailMfaCodes.findById(mfaData.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent code', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.emailMfaCodes.delete('non-existent-id');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteByEmail', () => {
    it('should delete all MFA codes for an email', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      for (let i = 0; i < 3; i++) {
        const mfaData = createMfaCodeData(email);
        await repos.emailMfaCodes.create({
          id: mfaData.id,
          email: mfaData.email,
          codeHash: mfaData.codeHash,
          expiresAt: mfaData.expiresAt,
          attemptCount: 0,
        });
      }

      const deletedCount = await repos.emailMfaCodes.deleteByEmail(email);

      expect(deletedCount).toBe(3);

      const codes = await repos.emailMfaCodes.findByEmail(email);
      expect(codes).toHaveLength(0);
    });

    it('should return 0 when email has no codes', async () => {
      const repos = getTestRepositories();

      const deletedCount = await repos.emailMfaCodes.deleteByEmail('nonexistent@example.com');

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteUnconsumedByEmail', () => {
    it('should only delete unconsumed codes for an email', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      // Create unconsumed codes
      const mfaData1 = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData1.id,
        email: mfaData1.email,
        codeHash: mfaData1.codeHash,
        expiresAt: mfaData1.expiresAt,
        attemptCount: 0,
      });

      const mfaData2 = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData2.id,
        email: mfaData2.email,
        codeHash: mfaData2.codeHash,
        expiresAt: mfaData2.expiresAt,
        attemptCount: 0,
      });

      // Create consumed code
      const mfaData3 = createMfaCodeData(email);
      const consumedCode = await repos.emailMfaCodes.create({
        id: mfaData3.id,
        email: mfaData3.email,
        codeHash: mfaData3.codeHash,
        expiresAt: mfaData3.expiresAt,
        attemptCount: 0,
      });
      await repos.emailMfaCodes.markConsumed(consumedCode.id);

      const deletedCount = await repos.emailMfaCodes.deleteUnconsumedByEmail(email);

      expect(deletedCount).toBe(2);

      const codes = await repos.emailMfaCodes.findByEmail(email);
      expect(codes).toHaveLength(1);
      expect(codes[0].id).toBe(consumedCode.id);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired MFA codes', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';

      // Create expired codes
      const expiredData1 = createExpiredMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: expiredData1.id,
        email: expiredData1.email,
        codeHash: expiredData1.codeHash,
        expiresAt: expiredData1.expiresAt,
        attemptCount: 0,
      });

      const expiredData2 = createExpiredMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: expiredData2.id,
        email: expiredData2.email,
        codeHash: expiredData2.codeHash,
        expiresAt: expiredData2.expiresAt,
        attemptCount: 0,
      });

      // Create valid code
      const validData = createMfaCodeData(email);
      const validCode = await repos.emailMfaCodes.create({
        id: validData.id,
        email: validData.email,
        codeHash: validData.codeHash,
        expiresAt: validData.expiresAt,
        attemptCount: 0,
      });

      const deletedCount = await repos.emailMfaCodes.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.emailMfaCodes.findById(validCode.id);
      expect(found).toBeDefined();
    });

    it('should return 0 when no expired codes exist', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const mfaData = createMfaCodeData(email);
      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const deletedCount = await repos.emailMfaCodes.deleteExpired();

      expect(deletedCount).toBe(0);
    });
  });
});
