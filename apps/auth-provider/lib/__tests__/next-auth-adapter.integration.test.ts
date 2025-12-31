import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Adapter } from 'next-auth/adapters';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  setGlobalRepositories,
  clearGlobalRepositories,
  createDbMockFactory,
} from '@/test/utils/db-mock';
import { createUserData, resetAllFactoryCounters } from '@/test/utils/factories';

// Store the adapter reference
let createAdapter: () => Adapter;

describe('NextAuth Adapter', () => {
  beforeAll(async () => {
    await setupTestDatabase();

    // Store repositories in global for the mock to access
    setGlobalRepositories(getTestRepositories());

    // Reset modules and set up mocks
    vi.resetModules();

    // Mock the database module
    vi.doMock('@/db', createDbMockFactory());

    // Dynamically import the adapter after mocking
    const adapterModule = await import('../next-auth-adapter');
    createAdapter = adapterModule.createAdapter;
  });

  afterAll(async () => {
    clearGlobalRepositories();
    vi.resetModules();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetAllFactoryCounters();
  });

  describe('createUser', () => {
    it('creates a new user and returns AdapterUser', async () => {
      const adapter = createAdapter();

      const adapterUser = await adapter.createUser!({
        email: 'newuser@example.com',
        emailVerified: new Date('2024-01-01'),
        name: 'New User',
        image: null,
      });

      expect(adapterUser).toBeDefined();
      expect(adapterUser.id).toBeDefined();
      expect(adapterUser.email).toBe('newuser@example.com');
      expect(adapterUser.name).toBe('New User');
      expect(adapterUser.emailVerified).toEqual(new Date('2024-01-01'));
    });

    it('creates user profile alongside user', async () => {
      const adapter = createAdapter();
      const repos = getTestRepositories();

      const adapterUser = await adapter.createUser!({
        email: 'profileuser@example.com',
        emailVerified: null,
        name: 'Profile User',
        image: null,
      });

      // Verify profile was created
      const profile = await repos.userProfiles.findByUserId(parseInt(adapterUser.id, 10));
      expect(profile).toBeDefined();
      expect(profile!.onboardingCompleted).toBe(false);
    });

    it('uses email prefix as f3Name when name is not provided', async () => {
      const adapter = createAdapter();
      const repos = getTestRepositories();

      const adapterUser = await adapter.createUser!({
        email: 'johndoe@example.com',
        emailVerified: null,
        name: null,
        image: null,
      });

      // Check that f3Name is derived from email
      const user = await repos.users.findById(parseInt(adapterUser.id, 10));
      expect(user!.f3Name).toBe('johndoe');
    });
  });

  describe('getUser', () => {
    it('returns user by ID', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'findme@example.com', f3Name: 'FindMe' });
      const createdUser = await repos.users.create(userData);

      const adapter = createAdapter();
      const adapterUser = await adapter.getUser!(String(createdUser.id));

      expect(adapterUser).toBeDefined();
      expect(adapterUser!.id).toBe(String(createdUser.id));
      expect(adapterUser!.email).toBe('findme@example.com');
      expect(adapterUser!.name).toBe('FindMe');
    });

    it('returns null for non-existent user', async () => {
      const adapter = createAdapter();
      const adapterUser = await adapter.getUser!('99999');

      expect(adapterUser).toBeNull();
    });
  });

  describe('getUserByEmail', () => {
    it('returns user by email', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'byemail@example.com', f3Name: 'ByEmail' });
      await repos.users.create(userData);

      const adapter = createAdapter();
      const adapterUser = await adapter.getUserByEmail!('byemail@example.com');

      expect(adapterUser).toBeDefined();
      expect(adapterUser!.email).toBe('byemail@example.com');
      expect(adapterUser!.name).toBe('ByEmail');
    });

    it('returns null for non-existent email', async () => {
      const adapter = createAdapter();
      const adapterUser = await adapter.getUserByEmail!('nonexistent@example.com');

      expect(adapterUser).toBeNull();
    });
  });

  describe('getUserByAccount', () => {
    it('always returns null (OAuth accounts not supported)', async () => {
      const adapter = createAdapter();
      const adapterUser = await adapter.getUserByAccount!({
        providerAccountId: 'google-123',
        provider: 'google',
      });

      expect(adapterUser).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('updates user and returns updated AdapterUser', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'update@example.com', f3Name: 'Original' });
      const createdUser = await repos.users.create(userData);

      const adapter = createAdapter();
      const adapterUser = await adapter.updateUser!({
        id: String(createdUser.id),
        name: 'Updated Name',
        email: 'updated@example.com',
      });

      expect(adapterUser.name).toBe('Updated Name');
      expect(adapterUser.email).toBe('updated@example.com');
    });

    it('updates emailVerified timestamp', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'verify@example.com', emailVerified: null });
      const createdUser = await repos.users.create(userData);

      const adapter = createAdapter();
      const verifiedDate = new Date('2024-06-01');
      const adapterUser = await adapter.updateUser!({
        id: String(createdUser.id),
        emailVerified: verifiedDate,
      });

      expect(adapterUser.emailVerified).toEqual(verifiedDate);
    });

    it('throws error for non-existent user', async () => {
      const adapter = createAdapter();

      await expect(
        adapter.updateUser!({
          id: '99999',
          name: 'Ghost',
        })
      ).rejects.toThrow('User with id 99999 not found');
    });
  });

  describe('deleteUser', () => {
    it('deletes user and profile', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'delete@example.com' });
      const createdUser = await repos.users.create(userData);
      await repos.userProfiles.create({
        userId: createdUser.id,
        onboardingCompleted: false,
      });

      const adapter = createAdapter();
      await adapter.deleteUser!(String(createdUser.id));

      // Verify user is deleted
      const deletedUser = await repos.users.findById(createdUser.id);
      expect(deletedUser).toBeNull();
    });
  });

  describe('linkAccount and unlinkAccount', () => {
    it('linkAccount returns null (not supported)', async () => {
      const adapter = createAdapter();
      const result = await adapter.linkAccount!({
        userId: '1',
        provider: 'google',
        providerAccountId: 'google-123',
        type: 'oauth',
      });

      expect(result).toBeNull();
    });

    it('unlinkAccount returns undefined (not supported)', async () => {
      const adapter = createAdapter();
      const result = await adapter.unlinkAccount!({
        provider: 'google',
        providerAccountId: 'google-123',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('session management', () => {
    it('createSession creates a new session', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'session@example.com' });
      const createdUser = await repos.users.create(userData);

      const adapter = createAdapter();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const session = await adapter.createSession!({
        sessionToken: 'test-session-token',
        userId: String(createdUser.id),
        expires,
      });

      expect(session.sessionToken).toBe('test-session-token');
      expect(session.userId).toBe(String(createdUser.id));
      expect(session.expires).toEqual(expires);
    });

    it('getSessionAndUser returns session and user', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'getsession@example.com', f3Name: 'SessionUser' });
      const createdUser = await repos.users.create(userData);

      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await repos.sessions.create({
        sessionToken: 'get-session-token',
        userId: createdUser.id,
        expires,
      });

      const adapter = createAdapter();
      const result = await adapter.getSessionAndUser!('get-session-token');

      expect(result).toBeDefined();
      expect(result!.session.sessionToken).toBe('get-session-token');
      expect(result!.user.email).toBe('getsession@example.com');
      expect(result!.user.name).toBe('SessionUser');
    });

    it('getSessionAndUser returns null for expired session', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'expired@example.com' });
      const createdUser = await repos.users.create(userData);

      // Create expired session
      const expired = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await repos.sessions.create({
        sessionToken: 'expired-session-token',
        userId: createdUser.id,
        expires: expired,
      });

      const adapter = createAdapter();
      const result = await adapter.getSessionAndUser!('expired-session-token');

      expect(result).toBeNull();
    });

    it('getSessionAndUser returns null for non-existent session', async () => {
      const adapter = createAdapter();
      const result = await adapter.getSessionAndUser!('nonexistent-token');

      expect(result).toBeNull();
    });

    it('updateSession updates session expiry', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'updatesession@example.com' });
      const createdUser = await repos.users.create(userData);

      const originalExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await repos.sessions.create({
        sessionToken: 'update-session-token',
        userId: createdUser.id,
        expires: originalExpires,
      });

      const adapter = createAdapter();
      const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const updated = await adapter.updateSession!({
        sessionToken: 'update-session-token',
        expires: newExpires,
      });

      expect(updated).toBeDefined();
      expect(updated!.expires).toEqual(newExpires);
    });

    it('updateSession returns null when expires not provided', async () => {
      const adapter = createAdapter();
      const result = await adapter.updateSession!({
        sessionToken: 'some-token',
      });

      expect(result).toBeNull();
    });

    it('deleteSession removes the session', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({ email: 'deletesession@example.com' });
      const createdUser = await repos.users.create(userData);

      await repos.sessions.create({
        sessionToken: 'delete-session-token',
        userId: createdUser.id,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const adapter = createAdapter();
      await adapter.deleteSession!('delete-session-token');

      // Verify session is deleted
      const deleted = await repos.sessions.findByToken('delete-session-token');
      expect(deleted).toBeNull();
    });
  });

  describe('verification tokens', () => {
    it('createVerificationToken creates a token', async () => {
      const adapter = createAdapter();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      const token = await adapter.createVerificationToken!({
        identifier: 'verify@example.com',
        token: 'verification-token-123',
        expires,
      });

      expect(token!.identifier).toBe('verify@example.com');
      expect(token!.token).toBe('verification-token-123');
      expect(token!.expires).toEqual(expires);
    });

    it('useVerificationToken consumes and returns the token', async () => {
      const repos = getTestRepositories();
      const expires = new Date(Date.now() + 60 * 60 * 1000);

      await repos.verificationTokens.create({
        identifier: 'use@example.com',
        token: 'use-token-123',
        expires,
      });

      const adapter = createAdapter();
      const consumed = await adapter.useVerificationToken!({
        identifier: 'use@example.com',
        token: 'use-token-123',
      });

      expect(consumed).toBeDefined();
      expect(consumed!.identifier).toBe('use@example.com');
      expect(consumed!.token).toBe('use-token-123');

      // Token should be consumed (deleted)
      const remaining = await repos.verificationTokens.find('use@example.com', 'use-token-123');
      expect(remaining).toBeNull();
    });

    it('useVerificationToken returns null for non-existent token', async () => {
      const adapter = createAdapter();
      const result = await adapter.useVerificationToken!({
        identifier: 'nonexistent@example.com',
        token: 'nonexistent-token',
      });

      expect(result).toBeNull();
    });
  });

  describe('toAdapterUser conversion', () => {
    it('converts User entity to AdapterUser format', async () => {
      const repos = getTestRepositories();
      const userData = createUserData({
        email: 'convert@example.com',
        f3Name: 'ConvertUser',
        emailVerified: new Date('2024-01-15'),
      });
      const createdUser = await repos.users.create(userData);

      // Update with avatar
      await repos.users.update(createdUser.id, { avatarUrl: 'https://example.com/avatar.png' });

      const adapter = createAdapter();
      const adapterUser = await adapter.getUser!(String(createdUser.id));

      expect(adapterUser!.id).toBe(String(createdUser.id));
      expect(adapterUser!.email).toBe('convert@example.com');
      expect(adapterUser!.name).toBe('ConvertUser');
      expect(adapterUser!.image).toBe('https://example.com/avatar.png');
      expect(adapterUser!.emailVerified).toEqual(new Date('2024-01-15'));
    });

    it('handles null email gracefully', async () => {
      const repos = getTestRepositories();
      // Create user with null email (edge case)
      const userData = createUserData({ email: null as unknown as string, f3Name: 'NoEmail' });
      const createdUser = await repos.users.create(userData);

      const adapter = createAdapter();
      const adapterUser = await adapter.getUser!(String(createdUser.id));

      expect(adapterUser!.email).toBe(''); // Converts null to empty string
    });
  });
});
