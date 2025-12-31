import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Environment settings
    // Use node environment by default; component tests can override via /// <reference types="vitest/config" />
    environment: 'node',

    // Test file patterns
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],

    // Setup files
    setupFiles: ['./test/setup.ts'],

    // Single-threaded for database tests to avoid connection conflicts
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Timeout settings
    testTimeout: 30000, // 30s for integration tests
    hookTimeout: 120000, // 120s for database container startup

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/*.ts', 'db/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/__tests__/**', '**/types/**'],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },

    // Reporter settings
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
