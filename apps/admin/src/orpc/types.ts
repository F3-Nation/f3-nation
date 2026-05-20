import type { InferRouterInputs, InferRouterOutputs } from "@orpc/server";

import type { router } from "@acme/api";

export type RouterInputs = InferRouterInputs<typeof router>;
export type RouterOutputs = InferRouterOutputs<typeof router>;
