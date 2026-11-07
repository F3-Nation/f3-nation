// @vitest-environment node

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
    await expect(importEnv()).rejects.toThrow(/Invalid environment variables/);
  });
});

// F3_API_BASE_URL is required and must be a URL, so a missing or malformed
// value fails when `env` is first imported, not on the first upstream request.
describe("env F3_API_BASE_URL validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("AUTH_PROVIDER_URL", "http://localhost:3001");
    vi.stubEnv("OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("OAUTH_REDIRECT_URI", "http://localhost:3002/callback");
    vi.stubEnv("F3_CHANNEL", "local");
    vi.stubEnv("GCS_CREDENTIALS", "credentials");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3002");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid URL and exposes it unchanged", async () => {
    vi.stubEnv("F3_API_BASE_URL", "https://api.test.f3nation.com/v1");

    const { env } = await import("@/env");

    expect(env.F3_API_BASE_URL).toBe("https://api.test.f3nation.com/v1");
  });

  it("rejects a missing value", async () => {
    vi.stubEnv("F3_API_BASE_URL", "");

    await expect(import("@/env")).rejects.toThrow(
      /Invalid environment variables/,
    );
  });

  it("rejects a value that is not a URL", async () => {
    vi.stubEnv("F3_API_BASE_URL", "not-a-url");

    await expect(import("@/env")).rejects.toThrow(
      /Invalid environment variables/,
    );
  });
});
