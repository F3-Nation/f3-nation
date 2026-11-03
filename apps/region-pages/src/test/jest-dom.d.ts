import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// Augment the `vitest` this app resolves; see vitest.setup.ts.
declare module "vitest" {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<
    any,
    any
  > {}
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
}
