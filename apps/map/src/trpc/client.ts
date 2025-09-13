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

// import { createORPCClient, onError } from '@orpc/client'
// import { RPCLink } from '@orpc/client/fetch'
// import { RouterClient } from '@orpc/server'
// import { ContractRouterClient } from '@orpc/contract'

// const link = new RPCLink({
//   url: 'http://localhost:3000/rpc',
//   headers: () => ({
//     authorization: 'Bearer token',
//   }),
//   // fetch: <-- provide fetch polyfill fetch if needed
//   interceptors: [
//     onError((error) => {
//       console.error(error)
//     })
//   ],
// })

// // Create a client for your router
// const client: RouterClient<typeof router> = createORPCClient(link)
// // Or, create a client using a contract
// const client: ContractRouterClient<typeof contract> = createORPCClient(link)