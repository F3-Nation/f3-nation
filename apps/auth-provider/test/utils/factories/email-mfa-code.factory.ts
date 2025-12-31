import crypto from 'crypto';
import type { EmailMfaCode, EmailMfaCodeInsert } from '@/db/types/email-mfa-code';

const CODE_TTL_MINUTES = 10;
let mfaCodeCounter = 0;

/**
 * Generate a 6-digit verification code.
 */
export function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Hash a verification code (matches the production hashing logic).
 */
export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Generate a unique MFA code ID.
 */
function generateMfaCodeId(): string {
  mfaCodeCounter++;
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate email MFA code data for inserting into the database.
 */
export function createMfaCodeData(
  email: string,
  overrides: Partial<Omit<EmailMfaCodeInsert, 'email'>> = {}
): EmailMfaCodeInsert & { plainCode: string } {
  const plainCode = generateVerificationCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);

  return {
    id: generateMfaCodeId(),
    email,
    codeHash: hashCode(plainCode),
    expiresAt,
    attemptCount: 0,
    plainCode, // Return plainCode for test assertions
    ...overrides,
  };
}

/**
 * Create a mock EmailMfaCode entity for unit tests.
 */
export function createMockMfaCode(
  email: string,
  overrides: Partial<Omit<EmailMfaCode, 'email'>> = {}
): EmailMfaCode & { plainCode: string } {
  mfaCodeCounter++;
  const plainCode = generateVerificationCode();
  const now = new Date();

  return {
    id: generateMfaCodeId(),
    email,
    codeHash: hashCode(plainCode),
    expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000),
    consumedAt: null,
    attemptCount: 0,
    createdAt: now,
    plainCode,
    ...overrides,
  };
}

/**
 * Create an expired MFA code for testing expiration logic.
 */
export function createExpiredMfaCodeData(
  email: string,
  overrides: Partial<Omit<EmailMfaCodeInsert, 'email'>> = {}
): EmailMfaCodeInsert & { plainCode: string } {
  const pastDate = new Date(Date.now() - 60 * 1000); // 1 minute ago
  return createMfaCodeData(email, {
    expiresAt: pastDate,
    ...overrides,
  });
}

/**
 * Create an already consumed MFA code for testing.
 */
export function createConsumedMfaCodeData(
  email: string,
  overrides: Partial<Omit<EmailMfaCodeInsert, 'email'>> = {}
): EmailMfaCodeInsert & { plainCode: string; consumedAt: Date } {
  const data = createMfaCodeData(email, overrides);
  return {
    ...data,
    consumedAt: new Date(),
  };
}

/**
 * Reset the MFA code counter (useful in beforeEach hooks).
 */
export function resetMfaCodeCounter(): void {
  mfaCodeCounter = 0;
}
