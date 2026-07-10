import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    // F3 SSO OAuth — http://localhost allowed; https enforced in code/prod.
    AUTH_PROVIDER_URL: z.url(),
    OAUTH_CLIENT_ID: z.string().min(1),
    OAUTH_CLIENT_SECRET: z.string().min(1),
    OAUTH_REDIRECT_URI: z.url(),
    F3_CHANNEL: z.enum(["local", "ci", "branch", "dev", "staging", "prod"]),
    // Base64-encoded service-account JSON for GCS public-image uploads.
    GCS_CREDENTIALS: z.string().min(1),
    GCS_EMULATOR_HOST: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_SITE_URL: z.string().min(1),
    NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
  },
  // With experimental__runtimeEnv (Next >= 13.4.4) only client + shared vars
  // need destructuring; server vars (OAuth) resolve from process.env automatically.
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
