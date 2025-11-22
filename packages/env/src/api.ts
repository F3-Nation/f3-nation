import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { nodeEnvSchema, skipValidation } from "./shared";

export const apiEnv = createEnv({
  server: {
    NODE_ENV: nodeEnvSchema,
    API_KEY: z.string().min(1),
  },
  client: {},
  experimental__runtimeEnv: {},
  skipValidation,
});
