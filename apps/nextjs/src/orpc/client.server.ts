import "server-only";

import { headers } from "next/headers";
import { createRouterClient } from "@orpc/server";

import { router } from "@acme/api";

globalThis.$client = createRouterClient(router, {
  /**
   * Provide initial context if needed.
   *
   * Because this client instance is shared across all requests,
   * only include context that's safe to reuse globally.
   * For per-request context, use middleware context or pass a function as the initial context.
   */
  context: async () => ({
    headers: await headers(), // provide headers if initial context required
    session: null,
  }),
});
