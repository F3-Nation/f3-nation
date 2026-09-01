import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    API_KEY: z.string().min(1),
    AUTH_JWT_PRIVATE_KEY: z.string().min(1),
    AUTH_SECRET: z.string().min(1),
    // Better Auth's own session-signing secret (#876 Phase 3) — deliberately
    // separate key material from AUTH_SECRET, which stays exclusively
    // NextAuth's. Optional here (checked at the point of use in
    // apps/auth/src/lib/better-auth.ts's getAuth()) so a deploy that hasn't
    // set it just can't turn on AUTH_USE_BETTER_AUTH, rather than failing
    // env validation outright.
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    // #876 Phase 3 kill switch. Off by default: mounts the Better Auth
    // instance (apps/auth/src/lib/better-auth.ts) at the isolated
    // /api/auth2/* path so it can be exercised without touching any of the
    // real /api/oauth/* traffic. Does not move any client cutover — see
    // apps/auth/src/lib/better-auth.ts's file-level comment for what this
    // flag does and does not do yet.
    AUTH_USE_BETTER_AUTH: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    DATABASE_HOST: z.string().min(1),
    DATABASE_USER: z.string().min(1),
    DATABASE_PASSWORD: z.string().min(1),
    DATABASE_NAME: z.string().min(1),
    DATABASE_PORT: z.coerce.number().min(1).default(5432),
    EMAIL_FROM: z.string().min(1),
    EMAIL_SERVER: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  client: {
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_AUTH_URL: z.url(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
  },
  skipValidation: !!process.env.CI || !!process.env.SKIP_ENV_VALIDATION,
});
