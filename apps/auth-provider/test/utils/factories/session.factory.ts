import crypto from 'crypto';
import type { Session, SessionInsert } from '@/db/types/session';

let sessionCounter = 0;

/**
 * Generate a unique session token.
 */
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate session data for inserting into the database.
 * Requires a valid userId that exists in the users table.
 */
export function createSessionData(
  userId: number,
  overrides: Partial<Omit<SessionInsert, 'userId'>> = {}
): SessionInsert {
  sessionCounter++;
  const now = new Date();
  const defaultExpires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  return {
    sessionToken: generateSessionToken(),
    userId,
    expires: defaultExpires,
    ...overrides,
  };
}

/**
 * Create a mock Session entity for unit tests.
 */
export function createMockSession(
  userId: number,
  overrides: Partial<Omit<Session, 'userId'>> = {}
): Session {
  sessionCounter++;
  const now = new Date();
  const defaultExpires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    sessionToken: generateSessionToken(),
    userId,
    expires: defaultExpires,
    ...overrides,
  };
}

/**
 * Create an expired session for testing expiration logic.
 */
export function createExpiredSessionData(
  userId: number,
  overrides: Partial<Omit<SessionInsert, 'userId'>> = {}
): SessionInsert {
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
  return createSessionData(userId, {
    expires: pastDate,
    ...overrides,
  });
}

/**
 * Create a session that expires soon (for testing near-expiration).
 */
export function createExpiringSessionData(
  userId: number,
  expiresInMs: number = 5 * 60 * 1000, // 5 minutes by default
  overrides: Partial<Omit<SessionInsert, 'userId'>> = {}
): SessionInsert {
  const soonDate = new Date(Date.now() + expiresInMs);
  return createSessionData(userId, {
    expires: soonDate,
    ...overrides,
  });
}

/**
 * Reset the session counter (useful in beforeEach hooks).
 */
export function resetSessionCounter(): void {
  sessionCounter = 0;
}
