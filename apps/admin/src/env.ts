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
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
