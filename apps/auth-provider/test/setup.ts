import { afterAll, beforeAll, vi } from 'vitest';

// Set test environment variables
// NODE_ENV is set by vitest automatically
process.env.NEXTAUTH_SECRET = 'test-secret-key-for-vitest-testing-only';
process.env.NEXTAUTH_URL = 'http://localhost:3000';

// Mock console.error to reduce noise in tests (optional, can be removed)
// Uncomment the following to suppress expected error logs:
// const originalConsoleError = console.error;
// beforeAll(() => {
//   console.error = vi.fn();
// });
// afterAll(() => {
//   console.error = originalConsoleError;
// });

// Global hooks
beforeAll(() => {
  // Any global setup before all tests
});

afterAll(() => {
  // Any global cleanup after all tests
  vi.restoreAllMocks();
});

// Extend expect with custom matchers if needed
// import { expect } from 'vitest';
// expect.extend({
//   // Custom matchers here
// });
