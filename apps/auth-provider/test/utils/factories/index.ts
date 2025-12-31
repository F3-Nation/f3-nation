// User factories
import {
  createUserData,
  createMockUser,
  createUserProfileData,
  createMockUserProfile,
  resetUserCounter,
} from './user.factory';

export {
  createUserData,
  createMockUser,
  createUserProfileData,
  createMockUserProfile,
  resetUserCounter,
};

// OAuth client factories
import {
  createOAuthClientData,
  createMockOAuthClient,
  createOAuthClientDataWithMultipleRedirects,
  resetOAuthClientCounter,
} from './oauth-client.factory';

export {
  createOAuthClientData,
  createMockOAuthClient,
  createOAuthClientDataWithMultipleRedirects,
  resetOAuthClientCounter,
};

// Session factories
import {
  createSessionData,
  createMockSession,
  createExpiredSessionData,
  createExpiringSessionData,
  resetSessionCounter,
} from './session.factory';

export {
  createSessionData,
  createMockSession,
  createExpiredSessionData,
  createExpiringSessionData,
  resetSessionCounter,
};

// Email MFA code factories
import {
  generateVerificationCode,
  hashCode,
  createMfaCodeData,
  createMockMfaCode,
  createExpiredMfaCodeData,
  createConsumedMfaCodeData,
  resetMfaCodeCounter,
} from './email-mfa-code.factory';

export {
  generateVerificationCode,
  hashCode,
  createMfaCodeData,
  createMockMfaCode,
  createExpiredMfaCodeData,
  createConsumedMfaCodeData,
  resetMfaCodeCounter,
};

/**
 * Reset all factory counters.
 * Call this in beforeEach() to ensure unique IDs across tests.
 */
export function resetAllFactoryCounters(): void {
  resetUserCounter();
  resetOAuthClientCounter();
  resetSessionCounter();
  resetMfaCodeCounter();
}
