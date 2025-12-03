import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { config } from "dotenv";
import mysql from "mysql2/promise";

const CHUNK_SIZE = 100;
const BACKUP_ROOT = path.resolve(__dirname, "..", ".data", "backups");
const SNAPSHOT_PATH = path.resolve(
  __dirname,
  "..",
  "drizzle",
  "meta",
  "0000_snapshot.json",
);
const envFile = process.env.MYSQL_ENV_FILE ?? ".env.local";
const ENV_PATH = path.resolve(__dirname, "..", envFile);

export interface Snapshot {
  tables?: Record<string, unknown>;
}

type DbRow = RowDataPacket;

config({ path: ENV_PATH });
config();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to ${envFile} before running the backup.`,
    );
  }
  return value;
}

export async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function loadTableNames(snapshotPath: string): Promise<string[]> {
  const snapshotRaw = await fs.promises.readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as Snapshot;

  if (!snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error(`No tables found in snapshot at ${snapshotPath}`);
  }

  return Object.keys(snapshot.tables);
}

export async function* fetchTableRows(
  pool: Pool,
  tableName: string,
  chunkSize: number,
): AsyncGenerator<DbRow[]> {
  let offset = 0;

  while (true) {
    const [rows] = await pool.query<DbRow[]>(
      `SELECT * FROM ?? LIMIT ? OFFSET ?`,
      [tableName, chunkSize, offset],
    );

    if (rows.length === 0) break;

    yield rows;
    offset += rows.length;
  }
}

export async function writeChunk(stream: fs.WriteStream, chunk: string) {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

export async function closeStream(stream: fs.WriteStream) {
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.end(resolve);
  });
  await finished(stream);
}

export async function backupTable(
  pool: Pool,
  tableName: string,
  backupDir: string,
): Promise<number> {
  const filePath = path.join(backupDir, `${tableName}.json`);
  await ensureDir(backupDir);

  const stream = fs.createWriteStream(filePath, { encoding: "utf8" });
  let total = 0;
  let wroteAny = false;

  await writeChunk(stream, "[");

  try {
    for await (const rows of fetchTableRows(pool, tableName, CHUNK_SIZE)) {
      if (!rows.length) continue;

      const serializedChunk = rows
        .map((row) => JSON.stringify(row))
        .join(",\n");
      const prefix = wroteAny ? ",\n" : "\n";

      await writeChunk(stream, `${prefix}${serializedChunk}`);

      wroteAny = true;
      total += rows.length;
    }

    await writeChunk(stream, wroteAny ? "\n]\n" : "]\n");
  } catch (error) {
    stream.destroy();
    throw error;
  }

  await closeStream(stream);

  return total;
}

export async function main() {
  const mysqlUrl = requireEnv("MYSQL_URL");

  await ensureDir(BACKUP_ROOT);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(BACKUP_ROOT, timestamp);

  await ensureDir(backupDir);

  const tableNames = await loadTableNames(SNAPSHOT_PATH);
  if (tableNames.length === 0) {
    throw new Error("No tables found to back up.");
  }

  const pool = mysql.createPool(mysqlUrl);

  try {
    for (const tableName of tableNames) {
      const count = await backupTable(pool, tableName, backupDir);
      console.log(`Backed up ${count} rows from ${tableName}`);
    }

    console.log(`Backup complete. Files written to ${backupDir}`);
  } finally {
    await pool.end();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
