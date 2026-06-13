import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    F3_CHANNEL: z.enum(["local", "ci", "branch", "dev", "staging", "prod"]),
    F3_MAP_BASE_URL: z.string().min(1),
    F3_API_BASE_URL: z.string().min(1),
    F3_ADMIN_BASE_URL: z.string().min(1),
    F3_GOOGLE_API_KEY: z.string().min(1),
    // F3 SSO OAuth — http://localhost allowed; https enforced in code/prod.
    AUTH_PROVIDER_URL: z.string().url(),
    OAUTH_CLIENT_ID: z.string().min(1),
    OAUTH_CLIENT_SECRET: z.string().min(1),
    OAUTH_REDIRECT_URI: z.string().url(),
  },
  client: {},
  experimental__runtimeEnv: {
    F3_CHANNEL: process.env.F3_CHANNEL,
    F3_MAP_BASE_URL: process.env.F3_MAP_BASE_URL,
    F3_API_BASE_URL: process.env.F3_API_BASE_URL,
    F3_ADMIN_BASE_URL: process.env.F3_ADMIN_BASE_URL,
    F3_GOOGLE_API_KEY: process.env.F3_GOOGLE_API_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    AUTH_PROVIDER_URL: process.env.AUTH_PROVIDER_URL,
    OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET,
    OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
