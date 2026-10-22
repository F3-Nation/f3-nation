import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSiteUrl, isStaticGenerationSkipped } from "@/lib/site";

const ENV_KEYS = ["SITE_URL", "SKIP_SSG", "F3_CHANNEL"] as const;

// Snapshot and clear the env keys these helpers read, so each test starts clean.
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getSiteUrl", () => {
  it("falls back to production when SITE_URL is unset", () => {
    expect(getSiteUrl()).toBe("https://regions.f3nation.com");
  });

  it("returns SITE_URL when set", () => {
    vi.stubEnv("SITE_URL", "https://staging.example.com");

    expect(getSiteUrl()).toBe("https://staging.example.com");
  });

  it("strips a single trailing slash", () => {
    vi.stubEnv("SITE_URL", "https://staging.example.com/");

    expect(getSiteUrl()).toBe("https://staging.example.com");
  });
});

describe("isStaticGenerationSkipped", () => {
  it("returns false when neither flag is set", () => {
    expect(isStaticGenerationSkipped()).toBe(false);
  });

  it("returns true when SKIP_SSG is 1", () => {
    vi.stubEnv("SKIP_SSG", "1");

    expect(isStaticGenerationSkipped()).toBe(true);
  });

  it("returns false when SKIP_SSG is set to anything other than 1", () => {
    vi.stubEnv("SKIP_SSG", "0");

    expect(isStaticGenerationSkipped()).toBe(false);
  });

  it("returns true when F3_CHANNEL is ci", () => {
    vi.stubEnv("F3_CHANNEL", "ci");

    expect(isStaticGenerationSkipped()).toBe(true);
  });

  it("returns false when F3_CHANNEL is a different channel", () => {
    vi.stubEnv("F3_CHANNEL", "prod");

    expect(isStaticGenerationSkipped()).toBe(false);
  });
});
