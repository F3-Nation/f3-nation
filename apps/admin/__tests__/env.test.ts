import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `~/env` reads process.env once at import time. Drive every operand in the
// skipValidation `||` chain explicitly so branch coverage is identical when
// the ambient CI variable is present and when tests run locally.
describe("env skipValidation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function importEnv() {
    const mod = await import("~/env");
    return mod.env;
  }

  // F3_API_BASE_URL is required, so blanking it makes the import throw unless
  // the bypass under test actually fired.
  it("skips validation when running in CI (operand 1)", async () => {
    vi.stubEnv("CI", "1");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("F3_API_BASE_URL", "");
    expect(await importEnv()).toBeDefined();
  });

  it("skips validation when SKIP_ENV_VALIDATION is set (operand 2)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("F3_API_BASE_URL", "");
    expect(await importEnv()).toBeDefined();
  });

  it("skips validation for the lint lifecycle event (operand 3)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "lint");
    vi.stubEnv("F3_API_BASE_URL", "");
    expect(await importEnv()).toBeDefined();
  });
});
