import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import "vitest";

// The base tsconfig restricts `types`, so the @testing-library/jest-dom/vitest
// module augmentation isn't auto-applied; declare it explicitly here.
declare module "vitest" {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<T, void> {}
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<unknown, void> {}
}
