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
    // GIT items are provided by the next.config.js
    NEXT_PUBLIC_GIT_COMMIT_HASH: z.string().optional(),
    NEXT_PUBLIC_GIT_BRANCH: z.string().optional(),
    NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
    NEXT_PUBLIC_MAP_API_KEY: z.string().min(1),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string(),
    TEST_DATABASE_URL: z.string(),
  },
  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_MAP_URL: z.string().min(1),
    NEXT_PUBLIC_API_URL: z.string().min(1),
    NEXT_PUBLIC_GOOGLE_API_KEY: z.string().min(1),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NEXT_PUBLIC_MAP_API_KEY: process.env.NEXT_PUBLIC_MAP_API_KEY,
    NEXT_PUBLIC_GOOGLE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    NEXT_PUBLIC_MAP_URL: process.env.NEXT_PUBLIC_MAP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_CHANNEL: process.env.NEXT_PUBLIC_CHANNEL,
    NEXT_PUBLIC_GIT_COMMIT_HASH: process.env.NEXT_PUBLIC_GIT_COMMIT_HASH,
    NEXT_PUBLIC_GIT_BRANCH: process.env.NEXT_PUBLIC_GIT_BRANCH,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
