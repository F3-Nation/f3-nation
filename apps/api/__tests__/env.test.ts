import { afterEach, describe, expect, it, vi } from "vitest";

// skipValidation's `||` chain short-circuits on CI in CI (CI=true is always set
// there), so the SKIP_ENV_VALIDATION and npm_lifecycle_event operands never
// naturally execute — stub each combination so both branches of every `||` run
// regardless of the ambient CI env var.
describe("env skipValidation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls through to SKIP_ENV_VALIDATION when CI is unset", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.resetModules();

    const { env } = await import("../src/env");

    expect(env).toBeDefined();
  });

  it("falls through to npm_lifecycle_event when CI and SKIP_ENV_VALIDATION are unset", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("npm_lifecycle_event", "lint");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.resetModules();

    const { env } = await import("../src/env");

    expect(env).toBeDefined();
  });
});
