// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Keep error logging for debugging
  error: console.error,
  // Silence info and logs in tests
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};
