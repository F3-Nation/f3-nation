import { createEnv } from "@t3-oss/env-nextjs";

import {
  commonClientSchema,
  commonServerSchema,
  skipValidation,
} from "./shared";

export const env = createEnv({
  server: commonServerSchema,
  client: commonClientSchema,
  experimental__runtimeEnv: {
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NEXT_PUBLIC_CHANNEL: process.env.NEXT_PUBLIC_CHANNEL,
  },
  skipValidation,
});
