import type { QueryClient } from "@tanstack/react-query";

import { createQueryClient } from "~/orpc/query-client";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
export const getQueryClient = () => {
  if (typeof window === "undefined") {
    return createQueryClient();
  } else {
    return (clientQueryClientSingleton ??= createQueryClient());
  }
};

/**
 * Invalidate by router segment; oRPC stores the path array at `queryKey[0]`
 * (the `Array.isArray` guard below covers non-oRPC keys), so a segment
 * matches at any depth. See `./invalidate-queries.test.ts`.
 */
export function invalidateQueries(
  keyOrOptions?: string | Parameters<QueryClient["invalidateQueries"]>[0],
) {
  if (typeof keyOrOptions === "string") {
    return getQueryClient().invalidateQueries({
      predicate: (query) => {
        const path = query.queryKey[0];
        return Array.isArray(path) && path.includes(keyOrOptions);
      },
    });
  }
  return getQueryClient().invalidateQueries(keyOrOptions);
}
