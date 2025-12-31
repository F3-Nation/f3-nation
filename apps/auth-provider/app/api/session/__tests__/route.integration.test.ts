import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  setMockSession,
  clearMockSession,
  createAuthenticatedSession,
  mockGetServerSession,
} from '@/test/utils/mocks';
import { createUserData, resetAllFactoryCounters } from '@/test/utils/factories';
import {
  setGlobalRepositories,
  clearGlobalRepositories,
  createDbMockFactory,
} from '@/test/utils/db-mock';

// Store the GET function reference
let GET: typeof import('../route').GET;

describe('GET /api/session', () => {
  beforeAll(async () => {
    await setupTestDatabase();

    // Store repositories in global for the mock to access
    setGlobalRepositories(getTestRepositories());

    // Reset all modules to clear any cached imports
    vi.resetModules();

    // Mock next-auth
    vi.doMock('next-auth', () => ({
      getServerSession: mockGetServerSession,
    }));

    // Mock the database module
    vi.doMock('@/db', createDbMockFactory());

    // Mock auth options
    vi.doMock('@/lib/auth', () => ({
      authOptions: {},
    }));

    // Dynamically import the route after mocking
    const routeModule = await import('../route');
    GET = routeModule.GET;
  });

  afterAll(async () => {
    clearGlobalRepositories();
    vi.resetModules();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetAllFactoryCounters();
    clearMockSession();
  });

  describe('unauthenticated', () => {
    it('returns null session when not authenticated', async () => {
      setMockSession(null);

      const response = await GET();
      const data = await response.json();

      expect(data).toBeNull();
    });
  });

  describe('authenticated without user data', () => {
    it('returns basic session when user not found in database', async () => {
      const session = createAuthenticatedSession(999, 'notfound@example.com');
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      // Should return the original session without enhancement
      expect(data.user.id).toBe(999);
      expect(data.user.email).toBe('notfound@example.com');
    });
  });

  describe('authenticated with user data', () => {
    it('returns enhanced session with user data from database', async () => {
      const repos = getTestRepositories();

      // Create user in database
      const userData = createUserData({
        f3Name: 'Maverick',
        email: 'maverick@example.com',
      });
      const user = await repos.users.create(userData);

      // Set mock session
      const session = createAuthenticatedSession(user.id, 'maverick@example.com');
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.id).toBe(user.id);
      expect(data.user.f3Name).toBe('Maverick');
      expect(data.user.onboardingCompleted).toBe(false);
    });

    it('returns enhanced session with profile data', async () => {
      const repos = getTestRepositories();

      // Create user in database
      const userData = createUserData({
        f3Name: 'Goose',
        email: 'goose@example.com',
      });
      const user = await repos.users.create(userData);

      // Create profile
      await repos.userProfiles.create({
        userId: user.id,
        hospitalName: 'Tom Kazansky',
        onboardingCompleted: true,
      });

      // Set mock session
      const session = createAuthenticatedSession(user.id, 'goose@example.com');
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.id).toBe(user.id);
      expect(data.user.f3Name).toBe('Goose');
      expect(data.user.hospitalName).toBe('Tom Kazansky');
      expect(data.user.onboardingCompleted).toBe(true);
    });

    it('handles user without profile', async () => {
      const repos = getTestRepositories();

      // Create user without profile
      const userData = createUserData({
        f3Name: 'Iceman',
        email: 'iceman@example.com',
      });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, 'iceman@example.com');
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.f3Name).toBe('Iceman');
      expect(data.user.onboardingCompleted).toBe(false);
      expect(data.user.hospitalName).toBeUndefined();
    });
  });

  describe('session fields', () => {
    it('includes expires field', async () => {
      const repos = getTestRepositories();

      const userData = createUserData({ email: 'test@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, 'test@example.com');
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      expect(data.expires).toBeDefined();
    });

    it('merges session user data with database data', async () => {
      const repos = getTestRepositories();

      const userData = createUserData({
        f3Name: 'TestF3',
        email: 'merge@example.com',
      });
      const user = await repos.users.create(userData);

      // Create session with some initial user data
      const session = createAuthenticatedSession(user.id, 'merge@example.com', {
        f3Name: 'OriginalF3',
      });
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      // Database f3Name should override session f3Name
      expect(data.user.f3Name).toBe('TestF3');
      // Original session email should be preserved
      expect(data.user.email).toBe('merge@example.com');
    });
  });

  describe('edge cases', () => {
    it('handles session with user.id but missing email', async () => {
      const repos = getTestRepositories();

      const userData = createUserData({ email: 'noemail@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, '');
      setMockSession(session);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.id).toBe(user.id);
    });
  });
});
