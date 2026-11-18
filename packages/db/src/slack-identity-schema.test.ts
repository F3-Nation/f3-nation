import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";

import { slackUsers } from "../drizzle/schema";

it("enforces uniqueness for each Slack account and workspace pair", () => {
  const constraint = getTableConfig(slackUsers).uniqueConstraints.find(
    (candidate) => candidate.name === "uq_slack_users_slack_id_team_id",
  );
  expect(constraint?.columns.map((column) => column.name)).toEqual([
    "slack_id",
    "slack_team_id",
  ]);
});
