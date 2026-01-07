import { StandardRPCJsonSerializer } from "@orpc/client/standard";
import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";

const serializer = new StandardRPCJsonSerializer();

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
        // Suppress abort errors - they're expected when queries are cancelled on unmount
        // This prevents console noise from expected behavior
        throwOnError: (error) => {
          // Don't throw abort errors - they're expected when components unmount
          if (
            error instanceof Error &&
            (error.name === "AbortError" ||
              error.message.includes("aborted") ||
              error.message.includes("signal is aborted"))
          ) {
            return false;
          }
          // Throw other errors normally
          return true;
        },
      },
      dehydrate: {
        serializeData(data) {
          const [json, meta] = serializer.serialize(data);
          return { json, meta };
        },
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData(data) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          return serializer.deserialize(data.json, data.meta);
        },
      },
    },
  });
