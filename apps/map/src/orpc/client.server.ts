import "server-only";

import { createRouterClient } from "@orpc/server";

import { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";

/**
 * Server-side oRPC client for static generation (SSG).
 *
 * This follows the oRPC SSR optimization pattern but WITHOUT calling headers()
 * which would opt the page out of static generation.
 *
 * We set isStaticGeneration: true to tell the middleware to skip auth().
 * This only works for public procedures that don't need authentication.
 *
 * @see https://orpc.dev/docs/best-practices/optimize-ssr
 */
globalThis.$client = createRouterClient(router, {
  context: async () => ({
    reqHeaders: new Headers({
      [Header.Client]: Client.ORPC_SSG,
    }),
  }),
});
