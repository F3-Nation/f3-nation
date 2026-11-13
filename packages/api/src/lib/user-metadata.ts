import { ORPCError } from "@orpc/server";

/** Removes reserved keys from API responses; non-object metadata fails closed. */
export const stripStravaMetadata = (
  meta: unknown,
): Record<string, unknown> | null | undefined => {
  if (meta == null) return meta;
  if (typeof meta !== "object" || Array.isArray(meta)) return null;
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !key.startsWith("strava_")),
  );
};

export const rejectStravaMetadata = (
  meta: Record<string, unknown> | null | undefined,
): void => {
  if (meta && Object.keys(meta).some((key) => key.startsWith("strava_"))) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Strava connection fields cannot be changed through a profile",
    });
  }
};
