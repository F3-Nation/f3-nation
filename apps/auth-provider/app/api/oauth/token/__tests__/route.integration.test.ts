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
import { createHash } from 'crypto';

// Store the route function references
let POST: typeof import('../route').POST;
let OPTIONS: typeof import('../route').OPTIONS;

describe('POST /api/oauth/token', () => {
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

  function createFormRequest(data: Record<string, string>, origin?: string): NextRequest {
    const formData = new URLSearchParams(data);
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (origin) {
      headers['Origin'] = origin;
    }
    return new NextRequest('http://localhost:3000/api/oauth/token', {
      method: 'POST',
      headers,
      body: formData.toString(),
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

  async function setupUserWithAuthCode(clientId: string, redirectUri: string) {
    const repos = getTestRepositories();
    const userData = createUserData({ email: 'user@example.com' });
    const user = await repos.users.create(userData);

    const code = 'test-auth-code-' + Date.now();
    await repos.oauthAuthorizationCodes.create({
      code,
      clientId,
      userId: user.id,
      redirectUri,
      scopes: 'openid profile email',
      codeChallenge: null,
      codeChallengeMethod: null,
      expires: new Date(Date.now() + 10 * 60 * 1000),
    });

    return { user, code };
  }

  async function setupUserWithAuthCodeAndPKCE(
    clientId: string,
    redirectUri: string,
    codeVerifier: string
  ) {
    const repos = getTestRepositories();
    const userData = createUserData({ email: 'pkce@example.com' });
    const user = await repos.users.create(userData);

    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const code = 'pkce-auth-code-' + Date.now();

    await repos.oauthAuthorizationCodes.create({
      code,
      clientId,
      userId: user.id,
      redirectUri,
      scopes: 'openid profile email',
      codeChallenge,
      codeChallengeMethod: 'S256',
      expires: new Date(Date.now() + 10 * 60 * 1000),
    });

    return { user, code };
  }

  describe('OPTIONS request', () => {
    it('returns 200 with CORS headers', async () => {
      const request = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3001',
        },
      });
      const response = await OPTIONS(request);

      expect(response.status).toBe(200);
    });
  });

  describe('parameter validation', () => {
    it('returns 400 when grant_type is missing', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        client_id: client.id,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toBe('Missing required parameters');
    });

    it('returns 400 when client_id is missing', async () => {
      const request = createFormRequest({
        grant_type: 'authorization_code',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
    });

    it('returns 400 for unsupported grant_type', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'password',
        client_id: client.id,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('unsupported_grant_type');
    });
  });

  describe('client validation', () => {
    it('returns 401 for invalid client_id', async () => {
      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: 'invalid-client',
        code: 'some-code',
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('invalid_client');
    });

    it('returns 401 for invalid client_secret when provided', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: 'wrong-secret',
        code: 'some-code',
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('invalid_client');
    });
  });

  describe('authorization_code grant', () => {
    it('returns 400 when code is missing', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toBe('Missing code or redirect_uri');
    });

    it('returns 400 when redirect_uri is missing', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code: 'some-code',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toBe('Missing code or redirect_uri');
    });

    it('returns 400 for invalid authorization code', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code: 'invalid-code',
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_grant');
    });

    it('exchanges valid code for tokens', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCode(client.id, 'http://localhost:3001/callback');

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
      expect(data.token_type).toBe('Bearer');
      expect(data.expires_in).toBe(3600);
      expect(data.refresh_token).toBeDefined();
      expect(data.scope).toBe('openid profile email');
    });

    it('code can only be used once', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCode(client.id, 'http://localhost:3001/callback');

      // First exchange - should succeed
      const request1 = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response1 = await POST(request1);
      expect(response1.status).toBe(200);

      // Second exchange - should fail
      const request2 = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response2 = await POST(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(400);
      expect(data2.error).toBe('invalid_grant');
    });

    it('returns 400 for wrong redirect_uri', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCode(client.id, 'http://localhost:3001/callback');

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code,
        redirect_uri: 'http://wrong-uri.com/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_grant');
    });
  });

  describe('PKCE', () => {
    it('returns 400 when code_verifier is missing for PKCE code', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCodeAndPKCE(
        client.id,
        'http://localhost:3001/callback',
        'my-secret-verifier'
      );

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        code,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_grant');
    });

    it('returns 400 for wrong code_verifier', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCodeAndPKCE(
        client.id,
        'http://localhost:3001/callback',
        'correct-verifier'
      );

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        code,
        redirect_uri: 'http://localhost:3001/callback',
        code_verifier: 'wrong-verifier',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_grant');
    });

    it('exchanges code with valid code_verifier', async () => {
      const client = await setupOAuthClient();
      const codeVerifier = 'my-super-secret-verifier-string-that-is-long-enough';
      const { code } = await setupUserWithAuthCodeAndPKCE(
        client.id,
        'http://localhost:3001/callback',
        codeVerifier
      );

      const request = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        code,
        redirect_uri: 'http://localhost:3001/callback',
        code_verifier: codeVerifier,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
    });
  });

  describe('refresh_token grant', () => {
    it('returns 400 when refresh_token is missing', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.clientSecret,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toBe('Missing refresh_token');
    });

    it('returns 400 for invalid refresh_token', async () => {
      const client = await setupOAuthClient();

      const request = createFormRequest({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.clientSecret,
        refresh_token: 'invalid-token',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_grant');
    });

    it('refreshes tokens with valid refresh_token', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCode(client.id, 'http://localhost:3001/callback');

      // First, get initial tokens
      const initialRequest = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const initialResponse = await POST(initialRequest);
      const initialData = await initialResponse.json();

      // Now refresh
      const refreshRequest = createFormRequest({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.clientSecret,
        refresh_token: initialData.refresh_token,
      });
      const refreshResponse = await POST(refreshRequest);
      const refreshData = await refreshResponse.json();

      expect(refreshResponse.status).toBe(200);
      expect(refreshData.access_token).toBeDefined();
      expect(refreshData.access_token).not.toBe(initialData.access_token);
      expect(refreshData.refresh_token).toBeDefined();
      expect(refreshData.refresh_token).not.toBe(initialData.refresh_token);
    });

    it('invalidates old tokens after refresh', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCode(client.id, 'http://localhost:3001/callback');

      // Get initial tokens
      const initialRequest = createFormRequest({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.clientSecret,
        code,
        redirect_uri: 'http://localhost:3001/callback',
      });
      const initialResponse = await POST(initialRequest);
      const initialData = await initialResponse.json();

      // Refresh tokens
      const refreshRequest = createFormRequest({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.clientSecret,
        refresh_token: initialData.refresh_token,
      });
      await POST(refreshRequest);

      // Try to use old refresh token again
      const secondRefreshRequest = createFormRequest({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.clientSecret,
        refresh_token: initialData.refresh_token,
      });
      const secondRefreshResponse = await POST(secondRefreshRequest);
      const secondRefreshData = await secondRefreshResponse.json();

      expect(secondRefreshResponse.status).toBe(400);
      expect(secondRefreshData.error).toBe('invalid_grant');
    });
  });

  describe('CORS handling', () => {
    it('sets CORS headers for valid origin', async () => {
      const client = await setupOAuthClient();
      const { code } = await setupUserWithAuthCode(client.id, 'http://localhost:3001/callback');

      const request = createFormRequest(
        {
          grant_type: 'authorization_code',
          client_id: client.id,
          client_secret: client.clientSecret,
          code,
          redirect_uri: 'http://localhost:3001/callback',
        },
        'http://localhost:3001'
      );
      const response = await POST(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');
    });
  });
});
