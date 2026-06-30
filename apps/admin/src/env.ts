import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    F3_CHANNEL: z.enum(["local", "ci", "branch", "dev", "staging", "prod"]),
    F3_MAP_BASE_URL: z.url(),
    F3_API_BASE_URL: z.url(),
    F3_ADMIN_BASE_URL: z.url(),
    F3_GOOGLE_API_KEY: z.string().min(1),
    // F3 SSO OAuth — http://localhost allowed; https enforced in code/prod.
    AUTH_PROVIDER_URL: z.url(),
    OAUTH_CLIENT_ID: z.string().min(1),
    OAUTH_CLIENT_SECRET: z.string().min(1),
    OAUTH_REDIRECT_URI: z.url(),
    // Base64-encoded service-account JSON for GCS public-image uploads.
    GCS_CREDENTIALS: z.string().min(1),
    GCS_EMULATOR_HOST: z.string().optional(),
  },
  client: {},
  // With experimental__runtimeEnv (Next >= 13.4.4) only client + shared vars
  // need destructuring; server vars resolve from process.env automatically.
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
