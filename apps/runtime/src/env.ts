import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Environment variables for the F3 redirect runtime service.
 *
 * See R5 plan Decision 8 for the `redirect_runtime` Neon role this
 * process connects as — its GRANTs are scoped to SELECT on 5 columns
 * of `region_custom_domains` only.
 *
 * `REDIRECT_PLATFORM_DATABASE_URL` is provisioned via Secret Manager
 * as `neon-redirect-runtime-url` and mounted by Cloud Run at boot.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    // Neon Postgres connection string for the `redirect_runtime` role.
    // Must point at the Neon pooler host (see R5 Decision 8, secret
    // `neon-redirect-runtime-url`).
    REDIRECT_PLATFORM_DATABASE_URL: z.string().url(),
    // Fallback target for unknown-hostname redirects. Fail-open — we
    // never 500 on the runtime (R5 Decision 3).
    RUNTIME_FALLBACK_REDIRECT_URL: z
      .string()
      .url()
      .default("https://redirect.f3nation.com/not-provisioned"),
  },
  client: {},
  experimental__runtimeEnv: {},
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
