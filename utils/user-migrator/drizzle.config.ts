import type { Config } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

if (!process.env.MYSQL_URL) {
  throw new Error(
    "MYSQL_URL is not set. Add it to .env.local before running drizzle-kit commands.",
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
