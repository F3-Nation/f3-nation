import type { Config } from "drizzle-kit";
import { config } from "dotenv";

const envFile = process.env.MYSQL_ENV_FILE ?? ".env.local";

config({ path: envFile });
config();

if (!process.env.MYSQL_URL) {
  throw new Error(
    `MYSQL_URL is not set. Add it to ${envFile} before running drizzle-kit commands.`,
  );
}

export default {
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.MYSQL_URL,
  },
} satisfies Config;
