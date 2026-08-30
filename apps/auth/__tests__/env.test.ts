import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `~/env` is built with @t3-oss/env-nextjs, which reads process.env once at
// import time. Its `skipValidation` is a two-operand `||` chain whose branch
// coverage otherwise depends on the ambient environment (CI short-circuits on
// `process.env.CI`, so the second operand is never evaluated there). These cases
// drive each operand and the no-bypass case deterministically via vi.stubEnv +
// a fresh import, so env.ts reports identical behavior locally and in CI.
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

  // API_KEY is a required non-empty string, so blanking it makes the import
  // throw unless the bypass under test actually fired.
  it("skips validation when running in CI (operand 1)", async () => {
    vi.stubEnv("CI", "1");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("API_KEY", "");
    expect((await importEnv()).API_KEY).toBeFalsy();
  });

  it("skips validation when SKIP_ENV_VALIDATION is set (operand 2)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("API_KEY", "");
    expect((await importEnv()).API_KEY).toBeFalsy();
  });

  it("validates when no bypass is active", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("API_KEY", "");
    await expect(importEnv()).rejects.toThrow();
  });
});
