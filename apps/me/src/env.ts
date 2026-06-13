import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // F3 SSO OAuth — http://localhost allowed; https enforced in code/prod.
    AUTH_PROVIDER_URL: z.string().url(),
    OAUTH_CLIENT_ID: z.string().min(1),
    OAUTH_CLIENT_SECRET: z.string().min(1),
    OAUTH_REDIRECT_URI: z.string().url(),
  },
  client: {
    NEXT_PUBLIC_SITE_URL: z.string().min(1),
    NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
  },
  // Server vars (OAuth) are read directly from process.env by t3-env; only
  // NEXT_PUBLIC_* client vars must be listed here for Next's static analysis.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
