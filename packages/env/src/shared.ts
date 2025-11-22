import { z } from "zod";

export const nodeEnvSchema = z
  .enum(["development", "production", "test"])
  .default("development");

export const clientChannelSchema = z.enum([
  "local",
  "ci",
  "branch",
  "dev",
  "staging",
  "prod",
]);

export const commonClientSchema = {
  NEXT_PUBLIC_URL: z.string().min(1),
  NEXT_PUBLIC_CHANNEL: clientChannelSchema,
};

export const commonServerSchema = {
  NODE_ENV: nodeEnvSchema,
  AUTH_SECRET:
    process.env.NODE_ENV === "production"
      ? z.string().min(1)
      : z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1),
  EMAIL_SERVER: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  EMAIL_ADMIN_DESTINATIONS: z.string().min(1),
  API_KEY: z.string().min(1),
  SUPER_ADMIN_API_KEY: z.string().min(1),
  NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED: z.string().optional(),
};

export const mapBucketSchema = {
  GOOGLE_LOGO_BUCKET_PRIVATE_KEY: z.string().min(1),
  GOOGLE_LOGO_BUCKET_CLIENT_EMAIL: z.string().min(1),
  GOOGLE_LOGO_BUCKET_BUCKET_NAME: z.string().min(1),
};

export const skipValidation =
  !!process.env.CI ||
  !!process.env.SKIP_ENV_VALIDATION ||
  process.env.npm_lifecycle_event === "lint";
