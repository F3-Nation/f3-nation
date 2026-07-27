import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { target } from "./transport";

/**
 * Invoke a procedure through a real oRPC client and return the raw wire
 * Response.
 *
 * Never hand-roll RPC wire frames: the encoding is the client library's
 * business, and a hand-rolled frame pins the test author's guess rather than
 * the protocol. But the typed client throws on non-2xx, which discards exactly
 * the envelope the error goldens exist to pin — so capture the response inside
 * the link's fetch and hand it back.
 */
export async function rpcResponse(
  call: (client: RouterClient<typeof router>) => Promise<unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const { link, captured } = buildLink(extraHeaders);
  const client: RouterClient<typeof router> = createORPCClient(link);
  let callError: unknown;
  try {
    await call(client);
  } catch (err) {
    // Expected for every non-2xx case; the response is already captured.
    callError = err;
  }
  const response = captured.value;
  if (!response) {
    throw new Error("rpcResponse: the link never returned a response", {
      cause: callError,
    });
  }
  return response;
}

// Return type inferred deliberately: RPCLink is generic over its client
// context, and spelling that parameter out here would pin a guess.
function buildLink(extraHeaders: Record<string, string>) {
  const captured: { value?: Response } = {};
  const link = new RPCLink({
    url: `${target.baseUrl}${API_PREFIX_V1}`,
    headers: { [Header.Client]: Client.ORPC, ...extraHeaders },
    fetch: async (input, init) => {
      const response = await target.invoke(new Request(input, init));
      // Clone: the client consumes the body, and the caller needs it too.
      captured.value = response.clone();
      return response;
    },
  });
  return { link, captured };
}
