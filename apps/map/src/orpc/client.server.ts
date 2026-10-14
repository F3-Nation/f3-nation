import "server-only";

import { createRouterClient } from "@orpc/server";

import { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";

/**
 * Server-side oRPC client for static generation (SSG).
 *
 * This follows the oRPC SSR optimization pattern but WITHOUT calling headers()
 * which would opt the page out of static generation — so it never has a real
 * user's cookies and can only ever act as an anonymous caller. It must only
 * be used for `publicReadProcedure` endpoints (see packages/api/src/shared.ts);
 * there is no credential here to elevate a protected call.
 *
 * @see https://orpc.dev/docs/best-practices/optimize-ssr
 */
globalThis.$client = createRouterClient(router, {
  context: async () => {
    const headers = new Headers({
      [Header.Client]: Client.ORPC_SSG,
    });
    return { reqHeaders: headers };
  },
});
