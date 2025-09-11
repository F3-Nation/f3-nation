import type { Config } from "drizzle-kit";

import { getDbUrl } from "./src/utils/functions";

const { databaseUrl: url, databaseName } = getDbUrl();

export default {
  schema: "./drizzle/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url },
  migrations: {
    schema: "drizzle",
    table: `__drizzle_migrations_${databaseName}`,
  },
  out: "../db/drizzle",
  // out: "../db/src/schema", // - needed for introspection
} satisfies Config;
