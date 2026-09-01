import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Only override DATABASE_URL from --url flag if in non-production (i.e., development or test) environment

const nodeEnv = process.env.NODE_ENV || "development";
if (nodeEnv !== "production") {
  const args = process.argv as string[] | undefined;
  const urlFlagIndex = args?.indexOf("--url") ?? -1;
  if (urlFlagIndex !== -1 && args?.[urlFlagIndex + 1]) {
    process.env.DATABASE_URL = args?.[urlFlagIndex + 1];
  }
}

export const env = createEnv({
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    EMAIL_SERVER: z.string().min(1),
    EMAIL_FROM: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    EMAIL_ADMIN_DESTINATIONS: z.string().min(1),
    EMAIL_REGION_IN_A_BOX_CC: z.string().min(1).optional(),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    API_KEY: z.string().min(1),
    SUPER_ADMIN_API_KEY: z.string().min(1).optional(),
    // A real, revocable database-backed API key (apps/admin's API Keys
    // page), granted the nation-admin role at the F3 Nation org — not a
    // shared secret. Used by packages/api/src/router/oauth-client.ts's
    // server-to-server calls to apps/auth's /api/admin/oauth-clients/*
    // routes. Optional so a deploy without it configured just can't use
    // that admin feature, rather than failing env validation outright —
    // same convention SUPER_ADMIN_API_KEY above already uses.
    AUTH_ADMIN_API_KEY: z.string().min(1).optional(),
    NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED: z.string().optional(),
    GCS_EMULATOR_HOST: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_ADMIN_URL: z.string().min(1).optional(),
    NEXT_PUBLIC_API_URL: z.string().min(1),
    NEXT_PUBLIC_AUTH_URL: z.url().optional(),
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
    NEXT_PUBLIC_ADMIN_URL: process.env.NEXT_PUBLIC_ADMIN_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
    NEXT_PUBLIC_MAP_URL: process.env.NEXT_PUBLIC_MAP_URL,
    NEXT_PUBLIC_CHANNEL: process.env.NEXT_PUBLIC_CHANNEL,
  },
  skipValidation: !!process.env.CI || !!process.env.SKIP_ENV_VALIDATION,
});
