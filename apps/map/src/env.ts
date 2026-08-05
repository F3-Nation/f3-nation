import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().min(1).optional(),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    F3_ADMIN_URL: z.url().optional(),
    F3_API_BASE_URL: z.url(),
    F3_CHANNEL: z.enum(["local", "ci", "branch", "dev", "staging", "prod"]),
    F3_GOOGLE_API_KEY: z.string().min(1),
    // Required in non-development environments, optional in development
    F3_MAP_API_KEY: z
      .string()
      .min(1)
      .optional()
      .refine(
        (val) => process.env.NODE_ENV === "development" || val !== undefined,
        { error: "Required in non-development environments" },
      ),
    F3_MAP_BASE_URL: z.url(),
    SUPER_ADMIN_API_KEY: z.string().min(1),
  },
  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {},
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
