import type { InferRouterOutputs } from "@orpc/server";

import type { router } from "@acme/api";

// infer the types for your router
export type RouterOutputs = InferRouterOutputs<typeof router>;
