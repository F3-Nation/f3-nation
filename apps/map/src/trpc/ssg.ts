import { createServerSideHelpers } from "@trpc/react-query/server";
import superjson from "superjson";

import { appRouter, createTRPCContext } from "@acme/api";

export const ssg = createServerSideHelpers({
  router: appRouter,
  ctx: await createTRPCContext({ session: "none", headers: null }),
  transformer: superjson, // optional - adds superjson serialization
});
