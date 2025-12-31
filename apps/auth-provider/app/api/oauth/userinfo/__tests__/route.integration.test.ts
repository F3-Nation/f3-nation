import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  createUserData,
  createOAuthClientData,
  resetAllFactoryCounters,
} from '@/test/utils/factories';
import {
  setGlobalRepositories,
  clearGlobalRepositories,
  createDbMockFactory,
} from '@/test/utils/db-mock';

// Store the route function references
let GET: typeof import('../route').GET;
let POST: typeof import('../route').POST;
let OPTIONS: typeof import('../route').OPTIONS;

describe('/api/oauth/userinfo', () => {
  beforeAll(async () => {
    await setupTestDatabase();

    // Store repositories in global for the mock to access
    setGlobalRepositories(getTestRepositories());

    // Reset all modules to clear any cached imports
    vi.resetModules();

    // Mock the database module
    vi.doMock('@/db', createDbMockFactory());

    // Dynamically import the route after mocking
    const routeModule = await import('../route');
    GET = routeModule.GET;
    POST = routeModule.POST;
    OPTIONS = routeModule.OPTIONS;
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

  function createGetRequest(accessToken?: string, origin?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (origin) {
      headers['Origin'] = origin;
    }
    return new NextRequest('http://localhost:3000/api/oauth/userinfo', {
      method: 'GET',
      headers,
    });
  }

  function createPostRequest(accessToken?: string, origin?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (origin) {
      headers['Origin'] = origin;
    }
    return new NextRequest('http://localhost:3000/api/oauth/userinfo', {
      method: 'POST',
      headers,
    });
  }

  async function setupOAuthClient() {
    const repos = getTestRepositories();
    const clientData = createOAuthClientData({
      redirectUris: JSON.stringify(['http://localhost:3001/callback']),
      allowedOrigin: 'http://localhost:3001',
      scopes: 'openid profile email',
    });
    await repos.oauthClients.create(clientData);
    return clientData;
  }

  async function setupUserWithAccessToken(
    clientId: string,
    scopes: string = 'openid profile email'
  ) {
    const repos = getTestRepositories();
    const userData = createUserData({
      f3Name: 'TestUser',
      email: 'testuser@example.com',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    const user = await repos.users.create(userData);

    // Mark email as verified
    await repos.users.update(user.id, {
      emailVerified: new Date(),
    });

    const token = 'valid-access-token-' + Date.now();
    await repos.oauthAccessTokens.create({
      token,
      clientId,
      userId: user.id,
      scopes,
      expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    return { user, token };
  }

  async function setupUserWithExpiredToken(clientId: string) {
    const repos = getTestRepositories();
    const userData = createUserData({ email: 'expired@example.com' });
    const user = await repos.users.create(userData);

    const token = 'expired-access-token-' + Date.now();
    await repos.oauthAccessTokens.create({
      token,
      clientId,
      userId: user.id,
      scopes: 'openid profile email',
      expires: new Date(Date.now() - 60 * 60 * 1000), // Expired 1 hour ago (avoid clock skew issues)
    });

    return { user, token };
  }

  describe('OPTIONS request', () => {
    it('returns 200 with CORS headers for any origin', async () => {
      const request = new NextRequest('http://localhost:3000/api/oauth/userinfo', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://any-origin.com',
        },
      });
      const response = await OPTIONS(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://any-origin.com');
    });
  });

  describe('GET /api/oauth/userinfo', () => {
    describe('authentication', () => {
      it('returns 401 when Authorization header is missing', async () => {
        const request = createGetRequest();
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('invalid_request');
        expect(data.error_description).toBe('Missing or invalid Authorization header');
      });

      it('returns 401 when Authorization header is not Bearer', async () => {
        const request = new NextRequest('http://localhost:3000/api/oauth/userinfo', {
          method: 'GET',
          headers: {
            Authorization: 'Basic some-credentials',
          },
        });
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('invalid_request');
      });

      it('returns 401 for invalid access token', async () => {
        const request = createGetRequest('invalid-token');
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('invalid_token');
        expect(data.error_description).toBe('Invalid or expired access token');
      });

      it('returns 401 for expired access token', async () => {
        const client = await setupOAuthClient();
        const { token } = await setupUserWithExpiredToken(client.id);

        const request = createGetRequest(token);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('invalid_token');
      });
    });

    describe('successful requests', () => {
      it('returns user info with all scopes', async () => {
        const client = await setupOAuthClient();
        const { user, token } = await setupUserWithAccessToken(client.id, 'openid profile email');

        const request = createGetRequest(token);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.sub).toBe(String(user.id));
        expect(data.name).toBe('TestUser');
        expect(data.email).toBe('testuser@example.com');
        expect(data.email_verified).toBe(true);
        expect(data.picture).toBe('https://example.com/avatar.jpg');
      });

      it('returns only sub with openid scope', async () => {
        const client = await setupOAuthClient();
        const { user, token } = await setupUserWithAccessToken(client.id, 'openid');

        const request = createGetRequest(token);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.sub).toBe(String(user.id));
        expect(data.name).toBeUndefined();
        expect(data.email).toBeUndefined();
      });

      it('returns profile data with profile scope', async () => {
        const client = await setupOAuthClient();
        const { user, token } = await setupUserWithAccessToken(client.id, 'openid profile');

        const request = createGetRequest(token);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.sub).toBe(String(user.id));
        expect(data.name).toBe('TestUser');
        expect(data.picture).toBe('https://example.com/avatar.jpg');
        expect(data.email).toBeUndefined();
      });

      it('returns email data with email scope', async () => {
        const client = await setupOAuthClient();
        const { user, token } = await setupUserWithAccessToken(client.id, 'openid email');

        const request = createGetRequest(token);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.sub).toBe(String(user.id));
        expect(data.email).toBe('testuser@example.com');
        expect(data.email_verified).toBe(true);
        expect(data.name).toBeUndefined();
      });
    });

    describe('user deleted', () => {
      it('returns 401 when user is deleted (token cascade deleted)', async () => {
        const repos = getTestRepositories();
        const client = await setupOAuthClient();
        const { user, token } = await setupUserWithAccessToken(client.id);

        // Delete user - tokens are cascade deleted due to FK constraint
        await repos.users.delete(user.id);

        // Token should no longer be valid since it was cascade deleted
        const request = createGetRequest(token);
        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('invalid_token');
      });
    });

    describe('CORS handling', () => {
      it('sets CORS headers for valid client origin', async () => {
        const client = await setupOAuthClient();
        const { token } = await setupUserWithAccessToken(client.id);

        const request = createGetRequest(token, 'http://localhost:3001');
        const response = await GET(request);

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');
      });

      it('does not set CORS headers for invalid origin', async () => {
        const client = await setupOAuthClient();
        const { token } = await setupUserWithAccessToken(client.id);

        const request = createGetRequest(token, 'http://evil.com');
        const response = await GET(request);

        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      });
    });
  });

  describe('POST /api/oauth/userinfo', () => {
    it('returns same response as GET', async () => {
      const client = await setupOAuthClient();
      const { user, token } = await setupUserWithAccessToken(client.id);

      const request = createPostRequest(token);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.sub).toBe(String(user.id));
      expect(data.name).toBe('TestUser');
      expect(data.email).toBe('testuser@example.com');
    });

    it('returns 401 when Authorization header is missing', async () => {
      const request = createPostRequest();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('invalid_request');
    });
  });

  describe('edge cases', () => {
    it('handles user with null avatar', async () => {
      const repos = getTestRepositories();
      const client = await setupOAuthClient();
      const userData = createUserData({
        f3Name: 'NoAvatar',
        email: 'noavatar@example.com',
        avatarUrl: null,
      });
      const user = await repos.users.create(userData);

      const token = 'no-avatar-token-' + Date.now();
      await repos.oauthAccessTokens.create({
        token,
        clientId: client.id,
        userId: user.id,
        scopes: 'openid profile',
        expires: new Date(Date.now() + 60 * 60 * 1000),
      });

      const request = createGetRequest(token);
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.picture).toBeNull();
    });

    it('handles user with unverified email', async () => {
      const repos = getTestRepositories();
      const client = await setupOAuthClient();
      const userData = createUserData({
        f3Name: 'Unverified',
        email: 'unverified@example.com',
      });
      const user = await repos.users.create(userData);
      // Note: emailVerified is null by default

      const token = 'unverified-token-' + Date.now();
      await repos.oauthAccessTokens.create({
        token,
        clientId: client.id,
        userId: user.id,
        scopes: 'openid email',
        expires: new Date(Date.now() + 60 * 60 * 1000),
      });

      const request = createGetRequest(token);
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.email).toBe('unverified@example.com');
      expect(data.email_verified).toBe(false);
    });
  });
});
