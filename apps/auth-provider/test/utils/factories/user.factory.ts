import type { User, UserInsert } from '@/db/types/user';
import type { UserProfile, UserProfileInsert } from '@/db/types/user-profile';

let userCounter = 0;

/**
 * Generate unique user data for inserting into the database.
 * Each call returns a new unique user.
 */
export function createUserData(overrides: Partial<UserInsert> = {}): UserInsert {
  userCounter++;
  return {
    f3Name: `TestUser${userCounter}`,
    firstName: `Test`,
    lastName: `User${userCounter}`,
    email: `testuser${userCounter}@example.com`,
    phone: `555-000-${userCounter.toString().padStart(4, '0')}`,
    status: 'active',
    ...overrides,
  };
}

/**
 * Create a mock User entity for unit tests (no database interaction).
 * Use when you need a complete User object without hitting the database.
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  userCounter++;
  const now = new Date();
  return {
    id: userCounter,
    f3Name: `MockUser${userCounter}`,
    firstName: `Mock`,
    lastName: `User${userCounter}`,
    email: `mockuser${userCounter}@example.com`,
    phone: `555-111-${userCounter.toString().padStart(4, '0')}`,
    homeRegionId: null,
    avatarUrl: null,
    meta: null,
    created: now,
    updated: now,
    emergencyContact: null,
    emergencyPhone: null,
    emergencyNotes: null,
    emailVerified: null,
    status: 'active',
    ...overrides,
  };
}

/**
 * Generate user profile data for inserting into the database.
 */
export function createUserProfileData(
  userId: number,
  overrides: Partial<UserProfileInsert> = {}
): UserProfileInsert {
  return {
    userId,
    hospitalName: null,
    onboardingCompleted: false,
    ...overrides,
  };
}

/**
 * Create a mock UserProfile entity for unit tests.
 */
export function createMockUserProfile(
  userId: number,
  overrides: Partial<UserProfile> = {}
): UserProfile {
  const now = new Date();
  return {
    userId,
    hospitalName: null,
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Reset the user counter (useful in beforeEach hooks).
 */
export function resetUserCounter(): void {
  userCounter = 0;
}
