import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
  simulateUnauthenticated,
  mockGetServerSession,
} from '@/test/utils/mocks';
import { createUserData, resetAllFactoryCounters } from '@/test/utils/factories';
import {
  setGlobalRepositories,
  clearGlobalRepositories,
  createDbMockFactory,
} from '@/test/utils/db-mock';

// Store the POST function reference
let POST: typeof import('../route').POST;

describe('POST /api/onboarding', () => {
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
    POST = routeModule.POST;
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

  function createRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/onboarding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      simulateUnauthenticated();

      const request = createRequest({
        f3Name: 'Maverick',
        hospitalName: 'Pete Mitchell',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('validation', () => {
    it('returns 400 when f3Name is missing', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ hospitalName: 'Test Name' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('F3 name is required');
    });

    it('returns 400 when f3Name is empty string', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ f3Name: '', hospitalName: 'Test Name' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('F3 name is required');
    });

    it('returns 400 when f3Name is whitespace only', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ f3Name: '   ', hospitalName: 'Test Name' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('F3 name is required');
    });

    it('returns 400 when f3Name is not a string', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ f3Name: 123, hospitalName: 'Test Name' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('F3 name is required');
    });

    it('returns 400 when hospitalName is missing', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ f3Name: 'Maverick' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Hospital name is required');
    });

    it('returns 400 when hospitalName is empty string', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ f3Name: 'Maverick', hospitalName: '' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Hospital name is required');
    });

    it('returns 400 when hospitalName is whitespace only', async () => {
      const repos = getTestRepositories();
      const userData = createUserData();
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({ f3Name: 'Maverick', hospitalName: '   ' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Hospital name is required');
    });
  });

  describe('successful onboarding', () => {
    it('creates profile and updates user for new user', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'new@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: 'Maverick',
        hospitalName: 'Pete Mitchell',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify user was updated
      const updatedUser = await repos.users.findById(user.id);
      expect(updatedUser?.f3Name).toBe('Maverick');
      expect(updatedUser?.firstName).toBe('Pete');
      expect(updatedUser?.lastName).toBe('Mitchell');

      // Verify profile was created
      const profile = await repos.userProfiles.findByUserId(user.id);
      expect(profile?.hospitalName).toBe('Pete Mitchell');
      expect(profile?.onboardingCompleted).toBe(true);
    });

    it('updates existing profile for returning user', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'existing@example.com' });
      const user = await repos.users.create(userData);

      // Create existing profile
      await repos.userProfiles.create({
        userId: user.id,
        hospitalName: 'Old Name',
        onboardingCompleted: false,
      });

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: 'Iceman',
        hospitalName: 'Tom Kazansky',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify profile was updated
      const profile = await repos.userProfiles.findByUserId(user.id);
      expect(profile?.hospitalName).toBe('Tom Kazansky');
      expect(profile?.onboardingCompleted).toBe(true);
    });

    it('parses single word hospital name correctly', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'single@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: 'Goose',
        hospitalName: 'Nick',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedUser = await repos.users.findById(user.id);
      expect(updatedUser?.firstName).toBe('');
      expect(updatedUser?.lastName).toBe('Nick');
    });

    it('parses multi-word hospital name correctly', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'multi@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: 'Viper',
        hospitalName: 'Mike Metcalf Jr',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedUser = await repos.users.findById(user.id);
      expect(updatedUser?.firstName).toBe('Mike Metcalf');
      expect(updatedUser?.lastName).toBe('Jr');
    });

    it('trims whitespace from inputs', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'trim@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: '  Maverick  ',
        hospitalName: '  Pete Mitchell  ',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedUser = await repos.users.findById(user.id);
      expect(updatedUser?.f3Name).toBe('Maverick');

      const profile = await repos.userProfiles.findByUserId(user.id);
      expect(profile?.hospitalName).toBe('Pete Mitchell');
    });
  });

  describe('edge cases', () => {
    it('handles f3Name with special characters', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'special@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: 'Mav-2.0',
        hospitalName: 'Test User',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedUser = await repos.users.findById(user.id);
      expect(updatedUser?.f3Name).toBe('Mav-2.0');
    });

    it('handles hospitalName with hyphenated last name', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'hyphen@example.com' });
      const user = await repos.users.create(userData);

      const session = createAuthenticatedSession(user.id, userData.email!);
      setMockSession(session);

      const request = createRequest({
        f3Name: 'TestUser',
        hospitalName: 'Jean-Pierre Smith-Jones',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedUser = await repos.users.findById(user.id);
      expect(updatedUser?.firstName).toBe('Jean-Pierre');
      expect(updatedUser?.lastName).toBe('Smith-Jones');
    });
  });
});
