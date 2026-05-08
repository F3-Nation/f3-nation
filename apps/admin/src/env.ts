import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    NEXT_PUBLIC_CHANNEL: z.enum([
      "local",
      "ci",
      "branch",
      "dev",
      "staging",
      "prod",
    ]),
    NEXT_PUBLIC_GIT_COMMIT_HASH: z.string().optional(),
    NEXT_PUBLIC_GIT_BRANCH: z.string().optional(),
  },
  server: {
    DATABASE_URL: z.string(),
    TEST_DATABASE_URL: z.string(),
  },
  client: {
    NEXT_PUBLIC_MAP_URL: z.string().min(1),
    NEXT_PUBLIC_API_URL: z.string().min(1),
    NEXT_PUBLIC_ADMIN_URL: z.string().min(1).default("http://localhost:3002"),
    NEXT_PUBLIC_GOOGLE_API_KEY: z.string().min(1),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_MAP_URL: process.env.NEXT_PUBLIC_MAP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ADMIN_URL:
      process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002",
    NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_CHANNEL: process.env.NEXT_PUBLIC_CHANNEL,
    NEXT_PUBLIC_GIT_COMMIT_HASH: process.env.NEXT_PUBLIC_GIT_COMMIT_HASH,
    NEXT_PUBLIC_GIT_BRANCH: process.env.NEXT_PUBLIC_GIT_BRANCH,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
