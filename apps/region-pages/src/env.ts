import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated config: a missing or malformed value fails at startup instead of
 * at first use. All server-only. NEXT_PUBLIC_* would be inlined at image build,
 * and one image serves both staging and prod.
 */
export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    // Public read-only API (apps/api), including the /v1 prefix.
    F3_API_BASE_URL: z.url(),
    F3_CHANNEL: z.enum(["local", "ci", "branch", "dev", "staging", "prod"]),
    // Canonical public origin for metadata, Open Graph URLs and the sitemap.
    SITE_URL: z.url().optional(),
    GA_MEASUREMENT_ID: z
      .string()
      .regex(/^G-[A-Z0-9]+$/)
      .optional(),
  },
  client: {},
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
