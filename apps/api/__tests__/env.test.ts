import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `../src/env` reads process.env once at import time. Drive every operand in
// the skipValidation `||` chain and the no-bypass case explicitly so behavior
// is independent of the ambient CI environment.
describe("env skipValidation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function importEnv() {
    const mod = await import("../src/env");
    return mod.env;
  }

  // AUTH_SECRET is required, so blanking it makes the import throw unless the
  // bypass under test actually fired.
  it("skips validation when running in CI (operand 1)", async () => {
    vi.stubEnv("CI", "1");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect((await importEnv()).AUTH_SECRET).toBeFalsy();
  });

  it("skips validation when SKIP_ENV_VALIDATION is set (operand 2)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect((await importEnv()).AUTH_SECRET).toBeFalsy();
  });

  it("skips validation for the lint lifecycle event (operand 3)", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "lint");
    vi.stubEnv("AUTH_SECRET", "");
    expect((await importEnv()).AUTH_SECRET).toBeFalsy();
  });

  it("validates when no bypass is active", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("AUTH_SECRET", "");
    await expect(importEnv()).rejects.toThrow();
  });
});
