import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import { createUserData, createUserProfileData, resetUserCounter } from '@/test/utils/factories';

describe('UserProfileRepository', () => {
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
    it('should create a user profile and return entity', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const profileData = createUserProfileData(user.id);

      const profile = await repos.userProfiles.create(profileData);

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(user.id);
      expect(profile.onboardingCompleted).toBe(false);
      expect(profile.hospitalName).toBeNull();
      expect(profile.createdAt).toBeDefined();
      expect(profile.updatedAt).toBeDefined();
    });

    it('should create a user profile with all fields', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const profileData = createUserProfileData(user.id, {
        hospitalName: 'Test Hospital',
        onboardingCompleted: true,
      });

      const profile = await repos.userProfiles.create(profileData);

      expect(profile.hospitalName).toBe('Test Hospital');
      expect(profile.onboardingCompleted).toBe(true);
    });

    it('should throw error when creating profile for non-existent user', async () => {
      const repos = getTestRepositories();
      const profileData = createUserProfileData(999999);

      await expect(repos.userProfiles.create(profileData)).rejects.toThrow();
    });

    it('should throw error when creating duplicate profile for same user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const profileData = createUserProfileData(user.id);

      await repos.userProfiles.create(profileData);

      await expect(repos.userProfiles.create(profileData)).rejects.toThrow();
    });
  });

  describe('findByUserId', () => {
    it('should find a profile by user ID', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const profileData = createUserProfileData(user.id, {
        hospitalName: 'Hospital ABC',
      });
      await repos.userProfiles.create(profileData);

      const found = await repos.userProfiles.findByUserId(user.id);

      expect(found).toBeDefined();
      expect(found?.userId).toBe(user.id);
      expect(found?.hospitalName).toBe('Hospital ABC');
    });

    it('should return null for non-existent user ID', async () => {
      const repos = getTestRepositories();

      const found = await repos.userProfiles.findByUserId(999999);

      expect(found).toBeNull();
    });

    it('should return null for user without profile', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const found = await repos.userProfiles.findByUserId(user.id);

      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('should update profile with partial data', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      await repos.userProfiles.create(createUserProfileData(user.id));

      const updated = await repos.userProfiles.update(user.id, {
        hospitalName: 'New Hospital',
      });

      expect(updated).toBeDefined();
      expect(updated?.hospitalName).toBe('New Hospital');
      expect(updated?.onboardingCompleted).toBe(false);
    });

    it('should update onboardingCompleted flag', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      await repos.userProfiles.create(createUserProfileData(user.id));

      const updated = await repos.userProfiles.update(user.id, {
        onboardingCompleted: true,
      });

      expect(updated?.onboardingCompleted).toBe(true);
    });

    it('should return null when updating non-existent profile', async () => {
      const repos = getTestRepositories();

      const updated = await repos.userProfiles.update(999999, {
        hospitalName: 'New Hospital',
      });

      expect(updated).toBeNull();
    });

    it('should return existing profile when updating with empty data', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const profile = await repos.userProfiles.create(
        createUserProfileData(user.id, { hospitalName: 'Test Hospital' })
      );

      const updated = await repos.userProfiles.update(user.id, {});

      expect(updated).toBeDefined();
      expect(updated?.userId).toBe(profile.userId);
      expect(updated?.hospitalName).toBe('Test Hospital');
    });
  });

  describe('upsert', () => {
    it('should create profile if it does not exist', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const profile = await repos.userProfiles.upsert({
        userId: user.id,
        hospitalName: 'New Hospital',
        onboardingCompleted: true,
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(user.id);
      expect(profile.hospitalName).toBe('New Hospital');
      expect(profile.onboardingCompleted).toBe(true);
    });

    it('should update profile if it already exists', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      await repos.userProfiles.create(
        createUserProfileData(user.id, { hospitalName: 'Original Hospital' })
      );

      const profile = await repos.userProfiles.upsert({
        userId: user.id,
        hospitalName: 'Updated Hospital',
        onboardingCompleted: true,
      });

      expect(profile.hospitalName).toBe('Updated Hospital');
      expect(profile.onboardingCompleted).toBe(true);

      // Verify only one profile exists
      const found = await repos.userProfiles.findByUserId(user.id);
      expect(found).toBeDefined();
      expect(found?.hospitalName).toBe('Updated Hospital');
    });
  });

  describe('delete', () => {
    it('should delete an existing profile and return true', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      await repos.userProfiles.create(createUserProfileData(user.id));

      const deleted = await repos.userProfiles.delete(user.id);

      expect(deleted).toBe(true);

      const found = await repos.userProfiles.findByUserId(user.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent profile', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.userProfiles.delete(999999);

      expect(deleted).toBe(false);
    });

    it('should be automatically deleted when user is deleted (cascade)', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      await repos.userProfiles.create(createUserProfileData(user.id));

      await repos.users.delete(user.id);

      const found = await repos.userProfiles.findByUserId(user.id);
      expect(found).toBeNull();
    });
  });
});
