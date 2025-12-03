import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import mysql from "mysql2/promise";

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

type SnapshotColumn = {
  type?: string;
};

type SnapshotTable = {
  columns?: Record<string, SnapshotColumn>;
};

type Snapshot = {
  tables?: Record<string, SnapshotTable>;
};

type TableRow = Record<string, unknown>;

config({ path: ENV_PATH });
config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local before running the seed.`,
    );
  }
  return value;
}

function ensureLocalMysqlUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`MYSQL_URL is not a valid URL: ${error}`);
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

async function loadSnapshot(snapshotPath: string): Promise<Snapshot> {
  const snapshotRaw = await fs.promises.readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as Snapshot;

  if (!snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error(`No tables found in snapshot at ${snapshotPath}`);
  }

  return snapshot;
}

function loadTableNames(snapshot: Snapshot): string[] {
  return Object.keys(snapshot.tables ?? {});
}

async function findLatestBackupDir(root: string): Promise<string> {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `No backups found. Expected a backup directory at ${root}. Run pnpm db:backup first.`,
    );
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((d) => d.name);
  if (dirs.length === 0) {
    throw new Error(
      `No backups found in ${root}. Run pnpm db:backup before seeding.`,
    );
  }

  const latest = dirs.sort((a, b) => b.localeCompare(a))[0];
  return path.join(root, latest);
}

async function loadBackupRows(
  tableName: string,
  backupDir: string,
): Promise<TableRow[]> {
  const filePath = path.join(backupDir, `${tableName}.json`);
  let raw: string;

  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Backup for table ${tableName} not found at ${filePath}. Ensure the latest backup is complete.`,
    );
  }

  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected backup format for ${tableName}. Expected an array of rows.`,
    );
  }

  return data as TableRow[];
}

function chunkRows(rows: TableRow[], size: number): TableRow[][] {
  const chunks: TableRow[][] = [];

  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }

  return chunks;
}

function collectColumns(rows: TableRow[]): string[] {
  const columns = new Set<string>();

  for (const row of rows) {
    Object.keys(row).forEach((key) => columns.add(key));
  }

  return Array.from(columns);
}

function getColumnsByType(
  tableName: string,
  snapshot: Snapshot,
  type: string,
): string[] {
  const table = snapshot.tables?.[tableName];
  if (!table || !table.columns) return [];

  return Object.entries(table.columns)
    .filter(([, column]) => column.type === type)
    .map(([name]) => name);
}

function normalizeDateValue(
  value: unknown,
  tableName: string,
  column: string,
): string {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }
  }

  const parsedDate =
    value instanceof Date
      ? value
      : new Date(typeof value === "string" ? value : (value as number));

  if (Number.isNaN(parsedDate.valueOf())) {
    throw new Error(
      `Unable to parse date for ${tableName}.${column}: ${String(value)}`,
    );
  }

  return parsedDate.toISOString().slice(0, 10);
}

function normalizeDatetimeValue(
  value: unknown,
  tableName: string,
  column: string,
): string {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
  }

  const parsedDate =
    value instanceof Date
      ? value
      : new Date(typeof value === "string" ? value : (value as number));

  if (Number.isNaN(parsedDate.valueOf())) {
    throw new Error(
      `Unable to parse datetime for ${tableName}.${column}: ${String(value)}`,
    );
  }

  return parsedDate.toISOString().replace("T", " ").slice(0, 19);
}

function normalizeRowsForTable(
  tableName: string,
  rows: TableRow[],
  snapshot: Snapshot,
): TableRow[] {
  const dateColumns = getColumnsByType(tableName, snapshot, "date");
  const datetimeColumns = getColumnsByType(tableName, snapshot, "datetime");
  const jsonColumns = getColumnsByType(tableName, snapshot, "json");
  if (!dateColumns.length && !datetimeColumns.length && !jsonColumns.length) {
    return rows;
  }

  return rows.map((row) => {
    const normalized: TableRow = { ...row };

    for (const column of dateColumns) {
      if (!(column in normalized)) continue;
      const value = normalized[column];
      if (value === null || value === undefined) continue;

      normalized[column] = normalizeDateValue(value, tableName, column);
    }

    for (const column of datetimeColumns) {
      if (!(column in normalized)) continue;
      const value = normalized[column];
      if (value === null || value === undefined) continue;

      normalized[column] = normalizeDatetimeValue(value, tableName, column);
    }

    for (const column of jsonColumns) {
      if (!(column in normalized)) continue;
      const value = normalized[column];
      if (value === null || value === undefined) {
        normalized[column] = null;
        continue;
      }

      normalized[column] = JSON.stringify(value);
    }

    return normalized;
  });
}

async function seedTable(
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

async function main() {
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
