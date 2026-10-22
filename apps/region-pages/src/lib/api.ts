import "server-only";

import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";

import { env } from "@/env";
import { logError, logWarn } from "@/lib/logging";

type ApiClient = RouterClient<typeof router>;
type RegionsResult = Awaited<ReturnType<ApiClient["regionPages"]["regions"]>>;

const API_TIMEOUT_MS = 15_000;

let client: ApiClient | undefined;

/**
 * Anonymous oRPC client for the public `regionPages.*` endpoints on apps/api.
 * Pages are ISR-rendered, so this only runs at (re)generation time.
 */
function getApiClient(): ApiClient {
  if (client) return client;
  const url = env.F3_API_BASE_URL;

  if (!url) {
    throw new Error("Missing required environment variable: F3_API_BASE_URL");
  }

  const link = new RPCLink({
    url,
    fetch: async (input, init) => {
      const startedAt = Date.now();
      const endpointPath = new URL(input.url).pathname;
      input.headers.set(Header.Client, Client.F3_REGION_PAGES);
      try {
        const response = await fetch(input, {
          ...init,
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
        if (!response.ok) {
          logWarn("region_pages.api.upstream_http_error", {
            endpointPath,
            status: response.status,
            durationMs: Date.now() - startedAt,
          });
        }
        return response;
      } catch (err) {
        logError(
          "region_pages.api.upstream_request_failed",
          { endpointPath, durationMs: Date.now() - startedAt },
          err,
        );
        throw err;
      }
    },
  });

  client = createORPCClient<ApiClient>(link);
  return client;
}

export const fetchRegions = (): Promise<RegionsResult> =>
  getApiClient().regionPages.regions();

export const fetchRegion = (slug: string) =>
  getApiClient().regionPages.region({ slug });
