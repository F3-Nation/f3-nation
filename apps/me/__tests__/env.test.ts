import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@/env` is built with @t3-oss/env-nextjs, which reads process.env once at
// import time. Its `skipValidation` is a three-operand `||` chain whose branch
// coverage otherwise depends on the ambient environment (e.g. CI short-circuits
// on `process.env.CI`, so only the first operand is ever evaluated there). These
// cases drive each operand and the no-bypass case deterministically via
// vi.stubEnv + a fresh import, so behavior is identical locally and in CI.
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
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect((await importEnv()).NEXT_PUBLIC_SITE_URL).toBeFalsy();
  });

  it("skips validation when SKIP_ENV_VALIDATION is set (operand 2)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect((await importEnv()).NEXT_PUBLIC_SITE_URL).toBeFalsy();
  });

  it("skips validation for the lint lifecycle event (operand 3)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "lint");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect((await importEnv()).NEXT_PUBLIC_SITE_URL).toBeFalsy();
  });

  it("validates when no bypass is active", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    await expect(importEnv()).rejects.toThrow();
  });
});
