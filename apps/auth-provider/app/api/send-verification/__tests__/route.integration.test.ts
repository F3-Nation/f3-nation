import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestPool,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  setupSendGridMock,
  teardownSendGridMock,
  getCapturedEmails,
  expectEmailSentTo,
  expectNoEmailsSent,
  setupSendGridMockWithError,
} from '@/test/utils/mocks';
import { resetAllFactoryCounters } from '@/test/utils/factories';
import {
  setGlobalRepositories,
  clearGlobalRepositories,
  createDbMockFactory,
} from '@/test/utils/db-mock';

// Store the POST function reference
let POST: typeof import('../route').POST;

// Flag to track if Docker is available
let dockerAvailable = true;

describe('POST /api/send-verification', () => {
  beforeAll(async () => {
    // Set required env vars for the route
    process.env.DATABASE_URL = 'test-database-url';
    process.env.TWILIO_SENDGRID_API_KEY = 'test-api-key';
    process.env.TWILIO_SENDGRID_TEMPLATE_ID = 'test-template-id';

    try {
      // Setup test database (requires Docker)
      await setupTestDatabase();

      // Store repositories in global for the mock to access
      setGlobalRepositories(getTestRepositories());

      // Reset all modules to clear any cached imports
      vi.resetModules();

      // Setup the mock for @/db
      vi.doMock('@/db', createDbMockFactory());

      // Dynamically import the route after mock is in place
      const routeModule = await import('../route');
      POST = routeModule.POST;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Could not find a working container runtime')
      ) {
        dockerAvailable = false;
        console.warn('Docker is not available. Integration tests will be skipped.');
      } else {
        throw error;
      }
    }
  });

  afterAll(async () => {
    if (dockerAvailable) {
      clearGlobalRepositories();
      vi.resetModules();
      await teardownTestDatabase();
    }
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetAllFactoryCounters();
    setupSendGridMock();
  });

  afterEach(() => {
    teardownSendGridMock();
  });

  function createRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/send-verification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  describe('successful requests', () => {
    it('sends verification email for valid email', async () => {
      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify email was captured by the mock
      const email = expectEmailSentTo('test@example.com');
      expect(email.dynamicTemplateData.code).toMatch(/^\d{6}$/);
      expect(email.dynamicTemplateData.expires_in_minutes).toBe(10);
    });

    it('sends verification email with callback URL', async () => {
      const request = createRequest({
        email: 'test@example.com',
        callbackUrl: '/dashboard',
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const email = expectEmailSentTo('test@example.com');
      expect(email.dynamicTemplateData.magic_link).toContain('callbackUrl=%2Fdashboard');
    });

    it('uses default callback URL when not provided', async () => {
      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);

      expect(response.status).toBe(200);

      const email = expectEmailSentTo('test@example.com');
      expect(email.dynamicTemplateData.magic_link).toContain('callbackUrl=%2F');
    });

    it('stores verification code in database', async () => {
      const request = createRequest({ email: 'test@example.com' });
      await POST(request);

      const pool = getTestPool();
      const result = await pool.query('SELECT * FROM auth.email_mfa_codes WHERE email = $1', [
        'test@example.com',
      ]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].email).toBe('test@example.com');
      expect(result.rows[0].code_hash).toBeDefined();
      expect(result.rows[0].attempt_count).toBe(0);
    });

    it('replaces existing verification code for same email', async () => {
      // Send first verification
      await POST(createRequest({ email: 'test@example.com' }));

      // Send second verification
      await POST(createRequest({ email: 'test@example.com' }));

      const pool = getTestPool();
      const result = await pool.query('SELECT * FROM auth.email_mfa_codes WHERE email = $1', [
        'test@example.com',
      ]);

      // Should only have one active code
      expect(result.rows.length).toBe(1);
    });
  });

  describe('validation errors', () => {
    it('returns 400 when email is missing', async () => {
      const request = createRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email is required');
      expectNoEmailsSent();
    });

    it('returns 400 when email is null', async () => {
      const request = createRequest({ email: null });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email is required');
    });

    it('returns 400 when email is not a string', async () => {
      const request = createRequest({ email: 123 });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email is required');
    });

    it('returns 400 for invalid email format', async () => {
      const request = createRequest({ email: 'invalid-email' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid email format');
      expectNoEmailsSent();
    });

    it('returns 400 for email without domain', async () => {
      const request = createRequest({ email: 'test@' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid email format');
    });

    it('returns 400 for email without username', async () => {
      const request = createRequest({ email: '@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid email format');
    });
  });

  describe('server configuration errors', () => {
    it('returns 500 when DATABASE_URL is not set', async () => {
      const originalDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Server configuration error');

      process.env.DATABASE_URL = originalDbUrl;
    });
  });

  describe('SendGrid errors', () => {
    it('returns 500 when SendGrid fails', async () => {
      teardownSendGridMock();
      setupSendGridMockWithError(500, 'SendGrid error');

      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to send verification email. Please try again.');
    });

    it('handles SendGrid rate limiting', async () => {
      teardownSendGridMock();
      setupSendGridMockWithError(429, 'Rate limited');

      const request = createRequest({ email: 'test@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to send verification email. Please try again.');
    });
  });

  describe('edge cases', () => {
    it('handles email with special characters', async () => {
      const request = createRequest({ email: 'test+tag@example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expectEmailSentTo('test+tag@example.com');
    });

    it('handles email with subdomain', async () => {
      const request = createRequest({ email: 'test@mail.example.com' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expectEmailSentTo('test@mail.example.com');
    });

    it('generates unique 6-digit codes', async () => {
      await POST(createRequest({ email: 'test1@example.com' }));
      await POST(createRequest({ email: 'test2@example.com' }));

      const emails = getCapturedEmails();
      expect(emails.length).toBe(2);
      expect(emails[0].dynamicTemplateData.code).toMatch(/^\d{6}$/);
      expect(emails[1].dynamicTemplateData.code).toMatch(/^\d{6}$/);
    });
  });
});
