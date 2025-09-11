import { env } from "@acme/env";

export const isProd = env.NEXT_PUBLIC_CHANNEL === "prod";
export const isTestMode = env.NODE_ENV === "test";
