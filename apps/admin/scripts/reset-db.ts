import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import mysql from "mysql2/promise";

const SNAPSHOT_PATH = path.resolve(
  __dirname,
  "..",
  "drizzle",
  "meta",
  "0000_snapshot.json",
);
const envFile = process.env.MYSQL_ENV_FILE ?? ".env.local";
const ENV_PATH = path.resolve(__dirname, "..", envFile);

interface Snapshot {
  tables?: Record<string, unknown>;
}

config({ path: ENV_PATH });
config();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to ${envFile} before running the reset.`,
    );
  }
  return value;
}

export function ensureLocalMysqlUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`MYSQL_URL is not a valid URL: ${errorMessage}`);
  }

  if (parsed.protocol !== "mysql:") {
    throw new Error(
      `MYSQL_URL must use the mysql protocol. Received: ${parsed.protocol}`,
    );
  }

  const allowedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "host.docker.internal",
  ]);

  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error(
      `MYSQL_URL must point to a local MySQL instance. Refusing to reset ${parsed.hostname}.`,
    );
  }
}

export async function loadTableNames(snapshotPath: string): Promise<string[]> {
  const snapshotRaw = await fs.promises.readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as Snapshot;

  if (!snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error(`No tables found in snapshot at ${snapshotPath}`);
  }

  return Object.keys(snapshot.tables);
}

export async function main() {
  const mysqlUrl = requireEnv("MYSQL_URL");

  ensureLocalMysqlUrl(mysqlUrl);

  const tableNames = await loadTableNames(SNAPSHOT_PATH);

  if (tableNames.length === 0) {
    throw new Error("No tables found to reset.");
  }

  const pool = mysql.createPool(mysqlUrl);
  const connection = await pool.getConnection();

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS=0");

    for (const tableName of tableNames) {
      await connection.query("TRUNCATE TABLE ??", [tableName]);
      console.log(`Cleared ${tableName}`);
    }
  } finally {
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS=1");
    } catch (error) {
      console.warn("Failed to re-enable foreign key checks:", error);
    }

    connection.release();
    await pool.end();
  }

  console.log("Database tables reset. Ready for pnpm db:seed.");
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
