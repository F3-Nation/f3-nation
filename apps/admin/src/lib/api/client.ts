import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { API_REQUEST_TIMEOUT_MS } from "~/lib/api/availability";
import { ACCESS_TOKEN_COOKIE_NAME } from "~/lib/auth/constants";

function requireApiBaseUrl(): string {
  const value = process.env.F3_API_BASE_URL;
  if (!value) {
    throw new Error("F3_API_BASE_URL is required");
  }

  const normalized = value.replace(/\/+$/, "");
  return normalized.endsWith(API_PREFIX_V1)
    ? normalized
    : `${normalized}${API_PREFIX_V1}`;
}

const getApiClient = cache(async (): Promise<RouterClient<typeof router>> => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  if (!accessToken) throw new Error("Missing access token");

  const link = new RPCLink({
    url: requireApiBaseUrl(),
    fetch: async (input, init) => {
      input.headers.set(Header.Client, Client.ORPC);
      input.headers.set(Header.Authorization, `Bearer ${accessToken}`);
      const response = await fetch(input, init);
      // A 5xx page from a proxy or load balancer (not a JSON oRPC error) would
      // otherwise surface as a body-parse error with its status lost, and be
      // mistaken for a bug rather than an outage.
      if (
        response.status >= 500 &&
        !response.headers.get("content-type")?.startsWith("application/json")
      ) {
        await response.body?.cancel();
        throw new ORPCError("SERVICE_UNAVAILABLE", { status: response.status });
      }
      return response;
    },
  });

  return createORPCClient<RouterClient<typeof router>>(link);
});

export async function getMyProfile() {
  const client = await getApiClient();
  const result = await client.me.profile(undefined, {
    signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
  });
  return result.user;
}
