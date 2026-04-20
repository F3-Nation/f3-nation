import "server-only";

import { createRouterClient } from "@orpc/server";

import { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";

globalThis.$client = createRouterClient(router, {
  context: async () => {
    const headers = new Headers({
      [Header.Client]: Client.ORPC_SSG,
    });
    return { reqHeaders: headers };
  },
});
