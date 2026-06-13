import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    GCS_BUCKET: z.string().min(1),
    // Base64-encoded service-account JSON. Shape (client_email / private_key)
    // is validated when the client is constructed in ./client. Eager validation
    // here is only skipped for test/CI (not GCS_EMULATOR_HOST), so emulator/local
    // dev must still set a non-empty placeholder (see `local-placeholder` in
    // apps/*/.env.example) to avoid a startup failure.
    GCS_CREDENTIALS: z.string().min(1),
  },
  experimental__runtimeEnv: {
    GCS_BUCKET: process.env.GCS_BUCKET,
    GCS_CREDENTIALS: process.env.GCS_CREDENTIALS,
  },
  emptyStringAsUndefined: true,
  // Eager validation would break the emulator tests, which set GCS_BUCKET but
  // not GCS_CREDENTIALS. Skip in test/CI; consumers retain their own guards.
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.NODE_ENV === "test",
});
