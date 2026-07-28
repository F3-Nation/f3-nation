import type { QueryClient } from "@tanstack/react-query";

import { createQueryClient } from "~/orpc/query-client";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
export const getQueryClient = (): QueryClient => {
  if (typeof window === "undefined") {
    return createQueryClient();
  } else {
    return (clientQueryClientSingleton ??= createQueryClient());
  }
};

/**
 * Invalidate by router segment; oRPC stores the path array at `queryKey[0]`
 * (the `Array.isArray` guard below covers non-oRPC keys), so a segment
 * matches at any depth — including the leaf procedure name, so a procedure
 * named `location` anywhere in the tree would also match
 * `invalidateQueries("location")`. Bear that in mind when naming procedures.
 * See `./invalidate-queries.test.ts`.
 */
export function invalidateQueries(
  keyOrOptions?: string | Parameters<QueryClient["invalidateQueries"]>[0],
): ReturnType<QueryClient["invalidateQueries"]> {
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
