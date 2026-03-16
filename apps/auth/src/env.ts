import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_JWT_PRIVATE_KEY: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    F3_API_BASE_URL: z.string().url(),
    F3_API_KEY: z.string().min(1),
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url(),
    SENDGRID_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  client: {},
  experimental__runtimeEnv: {},
  skipValidation: !!process.env.CI || !!process.env.SKIP_ENV_VALIDATION,
});
