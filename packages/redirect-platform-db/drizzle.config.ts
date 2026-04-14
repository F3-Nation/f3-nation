import type { Config } from "drizzle-kit";

const url = process.env.REDIRECT_PLATFORM_DATABASE_URL;
if (!url) {
  throw new Error(
    "REDIRECT_PLATFORM_DATABASE_URL is not defined — required for drizzle-kit",
  );
}

export default {
  schema: "./src/schema.ts",
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: { url },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations_redirect_platform",
  },
} satisfies Config;
