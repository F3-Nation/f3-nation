import path from "node:path";
import { config } from "dotenv";
import mysql from "mysql2/promise";

import type { TableRow } from "./seed-helpers";
import {
  chunkRows,
  collectColumns,
  findLatestBackupDir,
  loadBackupRows,
  loadSnapshot,
  loadTableNames,
  normalizeRowsForTable,
} from "./seed-helpers";

const BACKUP_ROOT = path.resolve(__dirname, "..", ".data", "backups");
const SNAPSHOT_PATH = path.resolve(
  __dirname,
  "..",
  "drizzle",
  "meta",
  "0000_snapshot.json",
);
const ENV_PATH = path.resolve(__dirname, "..", ".env.local");
const INSERT_BATCH_SIZE = 500;

config({ path: ENV_PATH });
config();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local before running the seed.`,
    );
  }
  return value;
}

export function ensureLocalMysqlUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MYSQL_URL is not a valid URL: ${message}`);
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
      `MYSQL_URL must point to a local MySQL instance. Refusing to seed ${parsed.hostname}.`,
    );
  }
}

export async function seedTable(
  connection: mysql.PoolConnection,
  tableName: string,
  rows: TableRow[],
): Promise<void> {
  await connection.query("TRUNCATE TABLE ??", [tableName]);

  if (!rows.length) {
    console.log(`Cleared ${tableName}; no rows to insert.`);
    return;
  }

  const columns = collectColumns(rows);

  if (!columns.length) {
    console.log(`Cleared ${tableName}; no columns detected to insert.`);
    return;
  }

  let inserted = 0;

  for (const chunk of chunkRows(rows, INSERT_BATCH_SIZE)) {
    const values = chunk.map((row) =>
      columns.map((column) => (row[column] === undefined ? null : row[column])),
    );

    await connection.query("INSERT INTO ?? (??) VALUES ?", [
      tableName,
      columns,
      values,
    ]);

    inserted += chunk.length;
  }

  console.log(`Seeded ${inserted} rows into ${tableName}`);
}

export async function main() {
  const mysqlUrl = requireEnv("MYSQL_URL");

  ensureLocalMysqlUrl(mysqlUrl);

  const snapshot = await loadSnapshot(SNAPSHOT_PATH);
  const backupDir = await findLatestBackupDir(BACKUP_ROOT);
  const tableNames = loadTableNames(snapshot);

  if (tableNames.length === 0) {
    throw new Error("No tables found to seed.");
  }

  const pool = mysql.createPool(mysqlUrl);
  const connection = await pool.getConnection();

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS=0");

    for (const tableName of tableNames) {
      const rows = await loadBackupRows(tableName, backupDir);
      const normalizedRows = normalizeRowsForTable(tableName, rows, snapshot);
      await seedTable(connection, tableName, normalizedRows);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS=1");
  } finally {
    connection.release();
    await pool.end();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
