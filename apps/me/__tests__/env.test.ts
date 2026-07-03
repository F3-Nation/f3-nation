import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@/env` is built with @t3-oss/env-nextjs, which reads process.env once at
// import time. Its `skipValidation` is a four-operand `||` chain whose branch
// coverage otherwise depends on the ambient environment (e.g. CI short-circuits
// on `process.env.CI`, so only the first operand is ever evaluated there). These
// cases drive each operand deterministically via vi.stubEnv + a fresh import, so
// env.ts reports identical branch coverage locally and in CI.
describe("env skipValidation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function importEnv() {
    const mod = await import("@/env");
    return mod.env;
  }

  it("skips validation when running in CI (operand 1)", async () => {
    vi.stubEnv("CI", "1");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    expect(await importEnv()).toBeDefined();
  });

  it("skips validation when SKIP_ENV_VALIDATION is set (operand 2)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    expect(await importEnv()).toBeDefined();
  });

  it("skips validation under NODE_ENV=test (operand 3)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(await importEnv()).toBeDefined();
  });

  it("skips validation for the lint lifecycle event (operand 4)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("npm_lifecycle_event", "lint");
    expect(await importEnv()).toBeDefined();
  });
});
