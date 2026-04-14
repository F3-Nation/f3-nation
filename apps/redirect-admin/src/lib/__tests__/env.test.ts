import { describe, it, expect } from "vitest";

import { EnvValidationError, loadEnv } from "../../env";

const FULL_ENV = {
  NEON_REDIRECT_ADMIN_UI_URL: "postgres://a",
  REGION_BINDING_VALIDATOR_URL: "http://v",
  REGION_BINDING_VALIDATOR_S2S_SECRET: "s",
  DATABASE_URL: "postgres://b",
  OAUTH_CLIENT_ID: "cid",
  OAUTH_CLIENT_SECRET: "csec",
  OAUTH_REDIRECT_URI: "http://r/cb",
  AUTH_PROVIDER_URL: "http://auth",
  SESSION_SECRET: "sess",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3006",
} as unknown as NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("returns typed env on a complete source", () => {
    const env = loadEnv(FULL_ENV);
    expect(env.NEON_REDIRECT_ADMIN_UI_URL).toBe("postgres://a");
    expect(env.neonAdminUiConnectionString).toBe("postgres://a");
    expect(env.supabaseConnectionString).toBe("postgres://b");
    expect(env.options.gcpProjectId).toBe("f3-redirects");
    expect(env.options.redirectCertMapName).toBe("redirect-platform-cert-map");
  });

  it("applies optional overrides", () => {
    const env = loadEnv({
      ...FULL_ENV,
      GCP_PROJECT_ID: "f3-test",
      REDIRECT_CERT_MAP_NAME: "test-map",
      REDIRECT_LB_IPV4: "1.2.3.4",
    });
    expect(env.options.gcpProjectId).toBe("f3-test");
    expect(env.options.redirectCertMapName).toBe("test-map");
    expect(env.options.redirectLbIpv4).toBe("1.2.3.4");
  });

  it("throws EnvValidationError listing missing vars", () => {
    // Remove two required vars and ensure the error mentions them.
    const partial: NodeJS.ProcessEnv = { ...FULL_ENV };
    delete partial.SESSION_SECRET;
    delete partial.OAUTH_CLIENT_ID;
    try {
      loadEnv(partial);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).toContain("SESSION_SECRET");
      expect((err as Error).message).toContain("OAUTH_CLIENT_ID");
    }
  });
});
