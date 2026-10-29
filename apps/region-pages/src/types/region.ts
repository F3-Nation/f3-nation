import type { InferRouterOutputs } from "@orpc/server";

import type { router } from "@acme/api";

type Outputs = InferRouterOutputs<typeof router>["regionPages"];

export type Region = Outputs["regions"][number];
export type Workout = NonNullable<Outputs["region"]>["workouts"][number];

/** Only what the directory list renders or searches; keeps the page payload small. */
export type RegionSummary = Pick<
  Region,
  | "name"
  | "slug"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "latitude"
  | "longitude"
  | "workoutCount"
>;

export const toRegionSummary = ({
  name,
  slug,
  city,
  state,
  zip,
  country,
  latitude,
  longitude,
  workoutCount,
}: Region): RegionSummary => ({
  name,
  slug,
  city,
  state,
  zip,
  country,
  latitude,
  longitude,
  workoutCount,
});
