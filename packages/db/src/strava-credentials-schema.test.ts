import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";

import { userStravaCredentials } from "../drizzle/schema";

it("keeps complete credentials per user and enforces athlete ownership", () => {
  const config = getTableConfig(userStravaCredentials);
  expect(userStravaCredentials.userId.primary).toBe(true);
  expect(config.columns.every((column) => column.notNull)).toBe(true);
  expect(
    config.uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name),
    ),
  ).toContainEqual(["athlete_id"]);
  expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
});
