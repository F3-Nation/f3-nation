import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "@acme/api";
import { AppType } from "@acme/shared/app/constants";
import { Header } from "@acme/shared/common/enums";

export const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: SuperJSON,
      url: `/api/trpc`,
      async headers() {
        const headers = new Headers();
        headers.set("x-trpc-source", "nextjs-client");
        headers.set(Header.Source, AppType.WEB);
        return headers;
      },
    }),
  ],
});
