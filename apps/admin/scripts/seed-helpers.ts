import fs from "node:fs";
import path from "node:path";

export interface SnapshotColumn {
  type?: string;
}

export interface SnapshotTable {
  columns?: Record<string, SnapshotColumn>;
}

export interface Snapshot {
  tables?: Record<string, SnapshotTable>;
}

export type TableRow = Record<string, unknown>;

export async function loadSnapshot(snapshotPath: string): Promise<Snapshot> {
  const snapshotRaw = await fs.promises.readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw) as Snapshot;

  if (!snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error(`No tables found in snapshot at ${snapshotPath}`);
  }

  return snapshot;
}

export function loadTableNames(snapshot: Snapshot): string[] {
  return Object.keys(snapshot.tables ?? {});
}

export async function findLatestBackupDir(root: string): Promise<string> {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `No backups found. Expected a backup directory at ${root}. Run pnpm db:backup first.`,
      { cause: error },
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

  const latest = dirs.sort((a, b) => b.localeCompare(a))[0]!;
  return path.join(root, latest);
}

export async function loadBackupRows(
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
      { cause: error },
    );
  }

  const data: unknown = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected backup format for ${tableName}. Expected an array of rows.`,
    );
  }

  return data as TableRow[];
}

export function chunkRows(rows: TableRow[], size: number): TableRow[][] {
  const chunks: TableRow[][] = [];

  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }

  return chunks;
}

export function collectColumns(rows: TableRow[]): string[] {
  const columns = new Set<string>();

  for (const row of rows) {
    Object.keys(row).forEach((key) => columns.add(key));
  }

  return Array.from(columns);
}

export function getColumnsByType(
  tableName: string,
  snapshot: Snapshot,
  type: string,
): string[] {
  const columns = snapshot.tables?.[tableName]?.columns;
  if (!columns) return [];

  return Object.entries(columns)
    .filter(([, column]) => column.type === type)
    .map(([name]) => name);
}

export function normalizeDateValue(
  value: unknown,
  tableName: string,
  column: string,
): string {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1]!;
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

export function normalizeDatetimeValue(
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

export function normalizeRowsForTable(
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
      const dateValue = normalized[column];
      if (dateValue === null || dateValue === undefined) continue;

      normalized[column] = normalizeDateValue(dateValue, tableName, column);
    }

    for (const column of datetimeColumns) {
      if (!(column in normalized)) continue;
      const datetimeValue = normalized[column];
      if (datetimeValue === null || datetimeValue === undefined) continue;

      normalized[column] = normalizeDatetimeValue(
        datetimeValue,
        tableName,
        column,
      );
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
