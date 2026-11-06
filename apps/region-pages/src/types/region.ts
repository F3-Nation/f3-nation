import type { InferRouterOutputs } from "@orpc/server";

import type { router } from "@acme/api";

type Outputs = InferRouterOutputs<typeof router>["regionPages"];

/** A region as its own page returns it (includes the contact email). */
export type Region = NonNullable<Outputs["region"]>["region"];
/** A region as the directory list returns it (no email). */
export type RegionListItem = Outputs["regions"][number];
export type Workout = NonNullable<Outputs["region"]>["workouts"][number];

/** Only what the directory list renders or searches; keeps the page payload small. */
export type RegionSummary = Pick<
  RegionListItem,
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
}: RegionListItem): RegionSummary => ({
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
