import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  createUserData,
  createSessionData,
  createExpiredSessionData,
  resetUserCounter,
  resetSessionCounter,
} from '@/test/utils/factories';

describe('SessionRepository', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetUserCounter();
    resetSessionCounter();
  });

  describe('create', () => {
    it('should create a session and return entity', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const sessionData = createSessionData(user.id);

      const session = await repos.sessions.create(sessionData);

      expect(session).toBeDefined();
      expect(session.sessionToken).toBe(sessionData.sessionToken);
      expect(session.userId).toBe(user.id);
      expect(session.expires).toBeDefined();
    });

    it('should throw error when creating session for non-existent user', async () => {
      const repos = getTestRepositories();
      const sessionData = createSessionData(999999);

      await expect(repos.sessions.create(sessionData)).rejects.toThrow();
    });

    it('should allow multiple sessions for the same user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const session1 = await repos.sessions.create(createSessionData(user.id));
      const session2 = await repos.sessions.create(createSessionData(user.id));

      expect(session1.sessionToken).not.toBe(session2.sessionToken);
      expect(session1.userId).toBe(session2.userId);
    });
  });

  describe('findByToken', () => {
    it('should find a session by token', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const sessionData = createSessionData(user.id);
      await repos.sessions.create(sessionData);

      const found = await repos.sessions.findByToken(sessionData.sessionToken);

      expect(found).toBeDefined();
      expect(found?.sessionToken).toBe(sessionData.sessionToken);
      expect(found?.userId).toBe(user.id);
    });

    it('should return null for non-existent token', async () => {
      const repos = getTestRepositories();

      const found = await repos.sessions.findByToken('non-existent-token');

      expect(found).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all sessions for a user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      await repos.sessions.create(createSessionData(user.id));
      await repos.sessions.create(createSessionData(user.id));
      await repos.sessions.create(createSessionData(user.id));

      const sessions = await repos.sessions.findByUserId(user.id);

      expect(sessions).toHaveLength(3);
      sessions.forEach(session => {
        expect(session.userId).toBe(user.id);
      });
    });

    it('should return empty array for user with no sessions', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const sessions = await repos.sessions.findByUserId(user.id);

      expect(sessions).toHaveLength(0);
    });

    it('should only return sessions for the specified user', async () => {
      const repos = getTestRepositories();
      const user1 = await repos.users.create(createUserData());
      const user2 = await repos.users.create(createUserData());

      await repos.sessions.create(createSessionData(user1.id));
      await repos.sessions.create(createSessionData(user1.id));
      await repos.sessions.create(createSessionData(user2.id));

      const sessions = await repos.sessions.findByUserId(user1.id);

      expect(sessions).toHaveLength(2);
      sessions.forEach(session => {
        expect(session.userId).toBe(user1.id);
      });
    });
  });

  describe('update', () => {
    it('should update session expiration', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const sessionData = createSessionData(user.id);
      await repos.sessions.create(sessionData);

      const newExpires = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
      const updated = await repos.sessions.update(sessionData.sessionToken, {
        expires: newExpires,
      });

      expect(updated).toBeDefined();
      expect(updated?.expires.getTime()).toBe(newExpires.getTime());
    });

    it('should return null when updating non-existent session', async () => {
      const repos = getTestRepositories();

      const updated = await repos.sessions.update('non-existent-token', {
        expires: new Date(),
      });

      expect(updated).toBeNull();
    });

    it('should return existing session when updating with empty data', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const sessionData = createSessionData(user.id);
      const created = await repos.sessions.create(sessionData);

      const updated = await repos.sessions.update(sessionData.sessionToken, {});

      expect(updated).toBeDefined();
      expect(updated?.sessionToken).toBe(created.sessionToken);
    });
  });

  describe('delete', () => {
    it('should delete an existing session and return true', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const sessionData = createSessionData(user.id);
      await repos.sessions.create(sessionData);

      const deleted = await repos.sessions.delete(sessionData.sessionToken);

      expect(deleted).toBe(true);

      const found = await repos.sessions.findByToken(sessionData.sessionToken);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent session', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.sessions.delete('non-existent-token');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all sessions for a user', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      await repos.sessions.create(createSessionData(user.id));
      await repos.sessions.create(createSessionData(user.id));
      await repos.sessions.create(createSessionData(user.id));

      const deletedCount = await repos.sessions.deleteByUserId(user.id);

      expect(deletedCount).toBe(3);

      const sessions = await repos.sessions.findByUserId(user.id);
      expect(sessions).toHaveLength(0);
    });

    it('should return 0 when user has no sessions', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      const deletedCount = await repos.sessions.deleteByUserId(user.id);

      expect(deletedCount).toBe(0);
    });

    it('should only delete sessions for the specified user', async () => {
      const repos = getTestRepositories();
      const user1 = await repos.users.create(createUserData());
      const user2 = await repos.users.create(createUserData());

      await repos.sessions.create(createSessionData(user1.id));
      await repos.sessions.create(createSessionData(user2.id));

      await repos.sessions.deleteByUserId(user1.id);

      const sessions1 = await repos.sessions.findByUserId(user1.id);
      const sessions2 = await repos.sessions.findByUserId(user2.id);

      expect(sessions1).toHaveLength(0);
      expect(sessions2).toHaveLength(1);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired sessions', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      // Create expired and valid sessions
      await repos.sessions.create(createExpiredSessionData(user.id));
      await repos.sessions.create(createExpiredSessionData(user.id));
      const validSession = await repos.sessions.create(createSessionData(user.id));

      const deletedCount = await repos.sessions.deleteExpired();

      expect(deletedCount).toBe(2);

      const found = await repos.sessions.findByToken(validSession.sessionToken);
      expect(found).toBeDefined();
    });

    it('should return 0 when no expired sessions exist', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());

      await repos.sessions.create(createSessionData(user.id));

      const deletedCount = await repos.sessions.deleteExpired();

      expect(deletedCount).toBe(0);
    });
  });

  describe('cascade delete', () => {
    it('should delete sessions when user is deleted', async () => {
      const repos = getTestRepositories();
      const user = await repos.users.create(createUserData());
      const sessionData = createSessionData(user.id);
      await repos.sessions.create(sessionData);

      await repos.users.delete(user.id);

      const found = await repos.sessions.findByToken(sessionData.sessionToken);
      expect(found).toBeNull();
    });
  });
});
