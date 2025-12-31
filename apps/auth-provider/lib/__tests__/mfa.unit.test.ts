import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock the repository before importing the module
vi.mock('@/db', () => ({
  emailMfaCodeRepository: {
    deleteExpired: vi.fn(),
    deleteUnconsumedByEmail: vi.fn(),
    create: vi.fn(),
    findLatestUnconsumed: vi.fn(),
    markConsumed: vi.fn(),
    incrementAttemptCount: vi.fn(),
  },
}));

// Import after mocking
import { createEmailVerification, verifyEmailCode } from '../mfa';
import { emailMfaCodeRepository } from '@/db';

// Mock fetch for SendGrid
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('mfa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Reset environment variables
    delete process.env.TWILIO_SENDGRID_API_KEY;
    delete process.env.TWILIO_SENDGRID_TEMPLATE_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createEmailVerification', () => {
    const testEmail = 'test@example.com';
    const testCallbackUrl = '/dashboard';

    it('creates a verification code and stores it in the repository', async () => {
      // Without SendGrid credentials, email is logged but not sent
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      await createEmailVerification(testEmail, testCallbackUrl);

      expect(emailMfaCodeRepository.deleteExpired).toHaveBeenCalled();
      expect(emailMfaCodeRepository.deleteUnconsumedByEmail).toHaveBeenCalledWith(testEmail);
      expect(emailMfaCodeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: testEmail,
          attemptCount: 0,
        })
      );
    });

    it('generates a 6-digit code hash', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      await createEmailVerification(testEmail, testCallbackUrl);

      const createCall = vi.mocked(emailMfaCodeRepository.create).mock.calls[0][0];
      // Code hash should be a SHA-256 hex string (64 characters)
      expect(createCall.codeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('sets expiration time to 10 minutes in the future', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      const beforeCall = Date.now();
      await createEmailVerification(testEmail, testCallbackUrl);
      const afterCall = Date.now();

      const createCall = vi.mocked(emailMfaCodeRepository.create).mock.calls[0][0];
      const expiresAt = createCall.expiresAt.getTime();

      // Should be approximately 10 minutes (600000ms) from now
      const expectedMin = beforeCall + 10 * 60 * 1000;
      const expectedMax = afterCall + 10 * 60 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });

    it('generates a UUID for verification ID', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      await createEmailVerification(testEmail, testCallbackUrl);

      const createCall = vi.mocked(emailMfaCodeRepository.create).mock.calls[0][0];
      // UUID format or hex string
      expect(createCall.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{32}$/
      );
    });

    it('cleans up expired codes before creating new one', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      await createEmailVerification(testEmail, testCallbackUrl);

      // Verify order: deleteExpired called before create
      const deleteExpiredOrder = vi.mocked(emailMfaCodeRepository.deleteExpired).mock
        .invocationCallOrder[0];
      const createOrder = vi.mocked(emailMfaCodeRepository.create).mock.invocationCallOrder[0];

      expect(deleteExpiredOrder).toBeLessThan(createOrder);
    });

    it('deletes unconsumed codes for the email before creating new one', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      await createEmailVerification(testEmail, testCallbackUrl);

      // Verify order: deleteUnconsumedByEmail called before create
      const deleteOrder = vi.mocked(emailMfaCodeRepository.deleteUnconsumedByEmail).mock
        .invocationCallOrder[0];
      const createOrder = vi.mocked(emailMfaCodeRepository.create).mock.invocationCallOrder[0];

      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('sends email via SendGrid when credentials are configured', async () => {
      process.env.TWILIO_SENDGRID_API_KEY = 'test-api-key';
      process.env.TWILIO_SENDGRID_TEMPLATE_ID = 'test-template-id';

      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await createEmailVerification(testEmail, testCallbackUrl);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('throws error when SendGrid request fails', async () => {
      process.env.TWILIO_SENDGRID_API_KEY = 'test-api-key';
      process.env.TWILIO_SENDGRID_TEMPLATE_ID = 'test-template-id';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(createEmailVerification(testEmail, testCallbackUrl)).rejects.toThrow(
        'Failed to send verification email'
      );
    });

    it('logs verification info in non-production environment', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      (process.env as { NODE_ENV: string }).NODE_ENV = 'development';

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      await createEmailVerification(testEmail, testCallbackUrl);

      expect(infoSpy).toHaveBeenCalledWith(
        'Email verification generated (development)',
        expect.objectContaining({
          email: testEmail,
        })
      );

      (process.env as { NODE_ENV: string | undefined }).NODE_ENV = originalNodeEnv;
    });
  });

  describe('verifyEmailCode', () => {
    const testEmail = 'test@example.com';
    const testCode = '123456';
    const testCodeHash = crypto.createHash('sha256').update(testCode).digest('hex');

    it('returns true for valid code', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce({
        id: 'test-id',
        email: testEmail,
        codeHash: testCodeHash,
        expiresAt: futureDate,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      const result = await verifyEmailCode(testEmail, testCode);

      expect(result).toBe(true);
      expect(emailMfaCodeRepository.markConsumed).toHaveBeenCalledWith('test-id');
    });

    it('returns false when no unconsumed code exists', async () => {
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce(null);

      const result = await verifyEmailCode(testEmail, testCode);

      expect(result).toBe(false);
    });

    it('returns false for expired code and marks it consumed', async () => {
      const pastDate = new Date(Date.now() - 5 * 60 * 1000);
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce({
        id: 'test-id',
        email: testEmail,
        codeHash: testCodeHash,
        expiresAt: pastDate,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      const result = await verifyEmailCode(testEmail, testCode);

      expect(result).toBe(false);
      expect(emailMfaCodeRepository.markConsumed).toHaveBeenCalledWith('test-id');
    });

    it('returns false for incorrect code and increments attempt count', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce({
        id: 'test-id',
        email: testEmail,
        codeHash: 'different-hash',
        expiresAt: futureDate,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      const result = await verifyEmailCode(testEmail, '999999');

      expect(result).toBe(false);
      expect(emailMfaCodeRepository.incrementAttemptCount).toHaveBeenCalledWith('test-id');
    });

    it('does not consume code when consumeCode is false', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce({
        id: 'test-id',
        email: testEmail,
        codeHash: testCodeHash,
        expiresAt: futureDate,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      const result = await verifyEmailCode(testEmail, testCode, false);

      expect(result).toBe(true);
      expect(emailMfaCodeRepository.markConsumed).not.toHaveBeenCalled();
    });

    it('returns false and logs error on repository exception', async () => {
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockRejectedValueOnce(
        new Error('Database error')
      );

      vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await verifyEmailCode(testEmail, testCode);

      expect(result).toBe(false);
    });

    it('correctly hashes the input code for comparison', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      const specificCode = '654321';
      const specificHash = crypto.createHash('sha256').update(specificCode).digest('hex');

      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce({
        id: 'test-id',
        email: testEmail,
        codeHash: specificHash,
        expiresAt: futureDate,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      const result = await verifyEmailCode(testEmail, specificCode);

      expect(result).toBe(true);
    });

    it('handles edge case of code expiring at exact verification time', async () => {
      // Code expires exactly now - should be treated as expired
      const now = new Date();
      vi.mocked(emailMfaCodeRepository.findLatestUnconsumed).mockResolvedValueOnce({
        id: 'test-id',
        email: testEmail,
        codeHash: testCodeHash,
        expiresAt: now,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      const result = await verifyEmailCode(testEmail, testCode);

      expect(result).toBe(false);
      expect(emailMfaCodeRepository.markConsumed).toHaveBeenCalledWith('test-id');
    });
  });
});
