import { sql } from "drizzle-orm";

import { db } from "./client";

async function main() {
  console.log("Enabling citext extension...");
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS citext;`);
    console.log("citext extension enabled successfully.");
  } catch (error) {
    console.error("Failed to enable citext extension:", error);
    process.exit(1);
  }
}

void main().then(() => process.exit(0));
