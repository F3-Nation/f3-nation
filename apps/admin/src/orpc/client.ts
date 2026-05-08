import type { RouterClient } from "@orpc/server";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { env } from "~/env";

declare global {
  var $client: RouterClient<typeof router> | undefined;
}

const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_API_URL}${API_PREFIX_V1}`,
  fetch: (input, init) => {
    input.headers.set(Header.Client, Client.ORPC);

    return fetch(input, {
      ...init,
      credentials: "include",
      headers: input.headers,
    });
  },
  interceptors: [
    onError((error: unknown) => {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        return;
      }
      console.error(error);
    }),
  ],
});

export const client: RouterClient<typeof router> =
  globalThis.$client ?? createORPCClient(link);
