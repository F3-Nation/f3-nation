import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Only override DATABASE_URL from --url flag if in non-production (i.e., development or test) environment

const nodeEnv = process.env.NODE_ENV || "development";
if (nodeEnv !== "production") {
  const args = process.argv;
  const urlFlagIndex = args.indexOf("--url");
  if (urlFlagIndex !== -1 && args[urlFlagIndex + 1]) {
    process.env.DATABASE_URL = args[urlFlagIndex + 1];
  }
}

export const env = createEnv({
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1),
    EMAIL_SERVER: z.string().min(1),
    EMAIL_FROM: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    EMAIL_ADMIN_DESTINATIONS: z.string().min(1),
    GOOGLE_LOGO_BUCKET_PRIVATE_KEY: z.string().min(1),
    GOOGLE_LOGO_BUCKET_CLIENT_EMAIL: z.string().min(1),
    GOOGLE_LOGO_BUCKET_BUCKET_NAME: z.string().min(1),
    TEST_DATABASE_URL: z.string().min(1),
    API_KEY: z.string().min(1),
    SUPER_ADMIN_API_KEY: z.string().min(1),
    NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_API_URL: z.string().min(1),
    NEXT_PUBLIC_MAP_URL: z.string().min(1),
    NEXT_PUBLIC_CHANNEL: z.enum([
      "local",
      "ci",
      "branch",
      "dev",
      "staging",
      "prod",
    ]),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_MAP_URL: process.env.NEXT_PUBLIC_MAP_URL,
    NEXT_PUBLIC_CHANNEL: process.env.NEXT_PUBLIC_CHANNEL,
  },
  skipValidation: !!process.env.CI || !!process.env.SKIP_ENV_VALIDATION,
});
