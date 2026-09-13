import { describe, expect, it } from "vitest";
import { routes } from "@acme/shared/app/constants";
import { resolveOrgSegment } from "./org-admin-config";

// Keep this independent of orgTypeDisplay so an accidental configuration
// collision with an existing non-org route cannot filter itself out.
const orgRouteKeys = new Set([
  "theNation",
  "sectors",
  "areas",
  "regions",
  "aos",
]);
const nonOrgSegments = [
  "api",
  "auth",
  ...Object.entries(routes.admin).flatMap(([key, route]) =>
    typeof route === "object" && !orgRouteKeys.has(key)
      ? [route.__path.split("/")[1]!]
      : [],
  ),
];

describe("organization route boundary", () => {
  it.each(nonOrgSegments)(
    "does not claim the existing /%s route",
    (segment) => {
      expect(resolveOrgSegment(segment)).toBeUndefined();
    },
  );
});
