import type { InferRouterOutputs } from "@orpc/server";

import type { router } from "@acme/api";

export type RouterOutputs = InferRouterOutputs<typeof router>;
