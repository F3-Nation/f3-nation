import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import { createUserData, resetUserCounter } from '@/test/utils/factories';

describe('UserRepository', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetUserCounter();
  });

  describe('create', () => {
    it('should create a user and return entity with ID', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();

      const user = await repos.users.create(userData);

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(typeof user.id).toBe('number');
      expect(user.email).toBe(userData.email);
      expect(user.f3Name).toBe(userData.f3Name);
      expect(user.firstName).toBe(userData.firstName);
      expect(user.lastName).toBe(userData.lastName);
      expect(user.status).toBe('active');
    });

    it('should create a user with all optional fields', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({
        homeRegionId: 123,
        avatarUrl: 'https://example.com/avatar.png',
        meta: JSON.stringify({ key: 'value' }),
        emergencyContact: 'John Doe',
        emergencyPhone: '555-123-4567',
        emergencyNotes: 'Call in emergency',
        emailVerified: new Date(),
      });

      const user = await repos.users.create(userData);

      expect(user.homeRegionId).toBe(123);
      expect(user.avatarUrl).toBe('https://example.com/avatar.png');
      expect(user.emergencyContact).toBe('John Doe');
      expect(user.emergencyPhone).toBe('555-123-4567');
      expect(user.emergencyNotes).toBe('Call in emergency');
      expect(user.emailVerified).toBeDefined();
    });

    it('should throw error when creating user with duplicate email', async () => {
      const repos = getTestRepositories();
      const email = 'duplicate@example.com';
      const userData1 = createUserData({ email });
      const userData2 = createUserData({ email });

      await repos.users.create(userData1);

      await expect(repos.users.create(userData2)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should find a user by ID', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const created = await repos.users.create(userData);

      const found = await repos.users.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.email).toBe(userData.email);
    });

    it('should return null for non-existent ID', async () => {
      const repos = getTestRepositories();

      const found = await repos.users.findById(999999);

      expect(found).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const created = await repos.users.create(userData);

      const found = await repos.users.findByEmail(userData.email!);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.email).toBe(userData.email);
    });

    it('should return null for non-existent email', async () => {
      const repos = getTestRepositories();

      const found = await repos.users.findByEmail('nonexistent@example.com');

      expect(found).toBeNull();
    });

    it('should be case-sensitive for email lookup', async () => {
      const repos = getTestRepositories();
      const email = 'test@example.com';
      const userData = createUserData({ email });
      await repos.users.create(userData);

      const found = await repos.users.findByEmail('TEST@EXAMPLE.COM');

      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a user with partial data', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const created = await repos.users.create(userData);

      const updated = await repos.users.update(created.id, {
        f3Name: 'UpdatedName',
        firstName: 'Updated',
      });

      expect(updated).toBeDefined();
      expect(updated?.f3Name).toBe('UpdatedName');
      expect(updated?.firstName).toBe('Updated');
      expect(updated?.lastName).toBe(userData.lastName);
      expect(updated?.email).toBe(userData.email);
    });

    it('should return null when updating non-existent user', async () => {
      const repos = getTestRepositories();

      const updated = await repos.users.update(999999, {
        f3Name: 'NewName',
      });

      expect(updated).toBeNull();
    });

    it('should return existing user when updating with empty data', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const created = await repos.users.create(userData);

      const updated = await repos.users.update(created.id, {});

      expect(updated).toBeDefined();
      expect(updated?.id).toBe(created.id);
      expect(updated?.email).toBe(userData.email);
    });

    it('should update emailVerified field', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const created = await repos.users.create(userData);
      const verifiedDate = new Date();

      const updated = await repos.users.update(created.id, {
        emailVerified: verifiedDate,
      });

      expect(updated).toBeDefined();
      expect(updated?.emailVerified).toBeDefined();
      expect(updated?.emailVerified?.getTime()).toBe(verifiedDate.getTime());
    });
  });

  describe('delete', () => {
    it('should delete an existing user and return true', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const created = await repos.users.create(userData);

      const deleted = await repos.users.delete(created.id);

      expect(deleted).toBe(true);

      const found = await repos.users.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent user', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.users.delete(999999);

      expect(deleted).toBe(false);
    });
  });
});
