import { vi } from 'vitest';
import type { Session } from 'next-auth';

/**
 * Extended session type matching the auth-provider's session structure.
 */
export interface MockSession extends Session {
  user: {
    id: number;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    onboardingCompleted?: boolean;
    hospitalName?: string | null;
    f3Name?: string | null;
  };
  expires: string;
}

// Store for mock session
let mockSession: MockSession | null = null;

/**
 * Create a mock session object.
 */
export function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  return {
    user: {
      id: 1,
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      onboardingCompleted: false,
      hospitalName: null,
      f3Name: 'TestUser',
      ...overrides.user,
    },
    expires: expires.toISOString(),
    ...overrides,
  };
}

/**
 * Set the mock session to be returned by getServerSession.
 */
export function setMockSession(session: MockSession | null): void {
  mockSession = session;
}

/**
 * Get the current mock session.
 */
export function getMockSession(): MockSession | null {
  return mockSession;
}

/**
 * Clear the mock session.
 */
export function clearMockSession(): void {
  mockSession = null;
}

/**
 * Mock getServerSession implementation.
 * This is the function that will be used as a mock for next-auth's getServerSession.
 */
export async function mockGetServerSession(): Promise<MockSession | null> {
  return mockSession;
}

/**
 * Create a vi.fn() mock for getServerSession with optional custom implementation.
 */
export function createGetServerSessionMock(
  customSession?: MockSession | null
): ReturnType<typeof vi.fn> {
  if (customSession !== undefined) {
    return vi.fn().mockResolvedValue(customSession);
  }
  return vi.fn().mockImplementation(mockGetServerSession);
}

/**
 * Setup the next-auth mock by mocking the module.
 * Call this at the top of your test file or in a setup file.
 *
 * Example usage:
 * ```typescript
 * vi.mock('next-auth/next', () => ({
 *   getServerSession: createGetServerSessionMock()
 * }));
 * ```
 */
export function getNextAuthMockConfig() {
  return {
    getServerSession: vi.fn().mockImplementation(mockGetServerSession),
  };
}

/**
 * Create a mock authenticated session for a specific user.
 */
export function createAuthenticatedSession(
  userId: number,
  email: string,
  options: {
    f3Name?: string;
    onboardingCompleted?: boolean;
    hospitalName?: string | null;
  } = {}
): MockSession {
  return createMockSession({
    user: {
      id: userId,
      email,
      name: options.f3Name || email.split('@')[0],
      f3Name: options.f3Name || email.split('@')[0],
      onboardingCompleted: options.onboardingCompleted ?? false,
      hospitalName: options.hospitalName ?? null,
      image: null,
    },
  });
}

/**
 * Create a mock session with completed onboarding.
 */
export function createOnboardedSession(
  userId: number,
  email: string,
  f3Name: string,
  hospitalName: string
): MockSession {
  return createAuthenticatedSession(userId, email, {
    f3Name,
    onboardingCompleted: true,
    hospitalName,
  });
}

/**
 * Mock helper to simulate no authentication.
 */
export function simulateUnauthenticated(): void {
  setMockSession(null);
}

/**
 * Mock helper to simulate authentication with a given user.
 */
export function simulateAuthenticated(
  userId: number,
  email: string,
  options: {
    f3Name?: string;
    onboardingCompleted?: boolean;
    hospitalName?: string | null;
  } = {}
): MockSession {
  const session = createAuthenticatedSession(userId, email, options);
  setMockSession(session);
  return session;
}
