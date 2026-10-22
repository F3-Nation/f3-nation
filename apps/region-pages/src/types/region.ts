import type { InferRouterOutputs } from "@orpc/server";

import type { router } from "@acme/api";

type Outputs = InferRouterOutputs<typeof router>["regionPages"];

export type Region = Outputs["regions"][number];
export type Workout = NonNullable<Outputs["region"]>["workouts"][number];
