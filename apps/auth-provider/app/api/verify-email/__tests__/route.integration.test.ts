import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  createMfaCodeData,
  createExpiredMfaCodeData,
  resetAllFactoryCounters,
} from '@/test/utils/factories';
import {
  setGlobalRepositories,
  clearGlobalRepositories,
  createDbMockFactory,
} from '@/test/utils/db-mock';

// Store the POST function reference
let POST: typeof import('../route').POST;

describe('POST /api/verify-email', () => {
  beforeAll(async () => {
    await setupTestDatabase();

    // Store repositories in global for the mock to access
    setGlobalRepositories(getTestRepositories());

    // Reset all modules to clear any cached imports
    vi.resetModules();

    // Setup the mock for @/db
    vi.doMock('@/db', createDbMockFactory());

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
  });

  function createRequest(body: unknown): NextRequest {
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    return new NextRequest('http://localhost:3000/api/verify-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(bodyStr.length),
      },
      body: bodyStr || undefined,
    });
  }

  function createEmptyRequest(): NextRequest {
    return new NextRequest('http://localhost:3000/api/verify-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '0',
      },
    });
  }

  describe('successful verification', () => {
    it('verifies valid code successfully', async () => {
      const repos = getTestRepositories();
      const mfaData = createMfaCodeData('test@example.com');

      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const request = createRequest({
        email: 'test@example.com',
        code: mfaData.plainCode,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.canSignIn).toBe(true);
    });

    it('allows verification without consuming the code', async () => {
      const repos = getTestRepositories();
      const mfaData = createMfaCodeData('test@example.com');

      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      // First verification
      const request1 = createRequest({
        email: 'test@example.com',
        code: mfaData.plainCode,
      });
      const response1 = await POST(request1);
      expect(response1.status).toBe(200);

      // Second verification should also work since code isn't consumed
      const request2 = createRequest({
        email: 'test@example.com',
        code: mfaData.plainCode,
      });
      const response2 = await POST(request2);
      expect(response2.status).toBe(200);
    });
  });

  describe('validation errors', () => {
    it('returns 400 when request body is empty', async () => {
      const request = createEmptyRequest();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Request body is required');
    });

    it('returns 400 when email is missing', async () => {
      const request = createRequest({ code: '123456' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email and verification code are required');
    });

    it('returns 400 when code is missing', async () => {
      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email and verification code are required');
    });

    it('returns 400 when both email and code are missing', async () => {
      const request = createRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email and verification code are required');
    });
  });

  describe('invalid verification', () => {
    it('returns 400 for wrong verification code', async () => {
      const repos = getTestRepositories();
      const mfaData = createMfaCodeData('test@example.com');

      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const request = createRequest({
        email: 'test@example.com',
        code: '000000', // Wrong code
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid verification code');
    });

    it('returns 400 for expired verification code', async () => {
      const repos = getTestRepositories();
      const mfaData = createExpiredMfaCodeData('test@example.com');

      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const request = createRequest({
        email: 'test@example.com',
        code: mfaData.plainCode,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid verification code');
    });

    it('returns 400 when no verification code exists for email', async () => {
      const request = createRequest({
        email: 'nonexistent@example.com',
        code: '123456',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid verification code');
    });

    it('returns 400 for code belonging to different email', async () => {
      const repos = getTestRepositories();
      const mfaData = createMfaCodeData('user1@example.com');

      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      const request = createRequest({
        email: 'user2@example.com', // Different email
        code: mfaData.plainCode,
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid verification code');
    });
  });

  describe('attempt tracking', () => {
    it('increments attempt count on wrong code', async () => {
      const repos = getTestRepositories();
      const mfaData = createMfaCodeData('test@example.com');

      await repos.emailMfaCodes.create({
        id: mfaData.id,
        email: mfaData.email,
        codeHash: mfaData.codeHash,
        expiresAt: mfaData.expiresAt,
        attemptCount: 0,
      });

      // First failed attempt
      await POST(
        createRequest({
          email: 'test@example.com',
          code: '000000',
        })
      );

      // Check attempt count was incremented
      const code = await repos.emailMfaCodes.findLatestUnconsumed('test@example.com');
      expect(code?.attemptCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles malformed JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '5',
        },
        body: '{bad}',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body');
    });

    it('verifies code with leading zeros correctly', async () => {
      const repos = getTestRepositories();
      // Manually create a code with leading zeros
      const code = '012345';
      const crypto = await import('crypto');
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');

      await repos.emailMfaCodes.create({
        id: crypto.randomUUID(),
        email: 'test@example.com',
        codeHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attemptCount: 0,
      });

      const request = createRequest({
        email: 'test@example.com',
        code: '012345',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
