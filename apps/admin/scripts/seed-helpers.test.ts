import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Snapshot, TableRow } from "./seed-helpers";
import {
  chunkRows,
  collectColumns,
  findLatestBackupDir,
  getColumnsByType,
  loadBackupRows,
  loadSnapshot,
  loadTableNames,
  normalizeDatetimeValue,
  normalizeDateValue,
  normalizeRowsForTable,
} from "./seed-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seed helper filesystem utilities", () => {
  it("loads a snapshot when tables exist", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      JSON.stringify({ tables: { users: {} } }),
    );

    const snapshot = await loadSnapshot("snapshot.json");

    expect(snapshot.tables).toHaveProperty("users");
  });

  it("throws when snapshot is missing tables", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      JSON.stringify({ something: {} }),
    );

    await expect(loadSnapshot("snapshot.json")).rejects.toThrowError(
      /No tables found/,
    );
  });

  it("finds the most recent backup directory", async () => {
    vi.spyOn(fs.promises, "readdir").mockResolvedValue([
      { name: "2023-01-01", isDirectory: () => true },
      { name: "2024-03-05", isDirectory: () => true },
      { name: "notes.txt", isDirectory: () => false },
    ] as unknown as fs.Dirent[]);

    const latest = await findLatestBackupDir("/backups");

    expect(latest).toBe(path.join("/backups", "2024-03-05"));
  });

  it("throws when backup directory is missing", async () => {
    vi.spyOn(fs.promises, "readdir").mockRejectedValue(new Error("nope"));

    await expect(findLatestBackupDir("/missing")).rejects.toThrowError(
      /No backups found/,
    );
  });

  it("loads backup rows from disk", async () => {
    const rows = [{ id: 1, name: "Alpha" }];
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(JSON.stringify(rows));

    const result = await loadBackupRows("users", "/backups/latest");

    expect(result).toEqual(rows);
  });

  it("throws when backup rows are not an array", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue("{}");

    await expect(
      loadBackupRows("users", "/backups/latest"),
    ).rejects.toThrowError(/Unexpected backup format/);
  });
});

describe("seed helper data utilities", () => {
  it("chunks rows into the expected sizes", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: index }));

    expect(chunkRows(rows, 2)).toEqual([
      [{ id: 0 }, { id: 1 }],
      [{ id: 2 }, { id: 3 }],
      [{ id: 4 }],
    ]);
  });

  it("collects unique column names across rows", () => {
    const rows: TableRow[] = [
      { id: 1, name: "One" },
      { name: "Two", active: true },
    ];

    expect(collectColumns(rows).sort()).toEqual(["active", "id", "name"]);
  });

  it("selects columns by type from the snapshot", () => {
    const snapshot: Snapshot = {
      tables: {
        users: {
          columns: {
            created_at: { type: "datetime" },
            birthday: { type: "date" },
            name: { type: "varchar" },
          },
        },
      },
    };

    expect(getColumnsByType("users", snapshot, "date")).toEqual(["birthday"]);
    expect(getColumnsByType("users", snapshot, "datetime")).toEqual([
      "created_at",
    ]);
    expect(getColumnsByType("users", snapshot, "json")).toEqual([]);
  });

  it("normalizes date and datetime values", () => {
    expect(
      normalizeDateValue("2024-02-03T10:00:00Z", "users", "birthday"),
    ).toBe("2024-02-03");

    expect(
      normalizeDatetimeValue("2024-02-03T10:11:12Z", "users", "created_at"),
    ).toBe("2024-02-03 10:11:12");

    expect(
      normalizeDatetimeValue(
        new Date("2024-02-03T10:11:12Z"),
        "users",
        "created_at",
      ),
    ).toBe("2024-02-03 10:11:12");

    expect(() => normalizeDateValue("invalid", "users", "birthday")).toThrow(
      /Unable to parse date/,
    );
  });

  it("normalizes rows for date, datetime, and json columns", () => {
    const snapshot: Snapshot = {
      tables: {
        users: {
          columns: {
            created_at: { type: "datetime" },
            birthday: { type: "date" },
            profile: { type: "json" },
          },
        },
      },
    };

    const rows: TableRow[] = [
      {
        created_at: "2024-02-03T10:11:12Z",
        birthday: new Date("2024-02-03T10:11:12Z"),
        profile: { city: "Charlotte" },
        untouched: 5,
      },
      { created_at: null, birthday: undefined, profile: null },
    ];

    const normalized = normalizeRowsForTable("users", rows, snapshot);

    expect(normalized[0]).toEqual({
      created_at: "2024-02-03 10:11:12",
      birthday: "2024-02-03",
      profile: '{"city":"Charlotte"}',
      untouched: 5,
    });
    expect(normalized[1]).toEqual({
      created_at: null,
      birthday: undefined,
      profile: null,
    });
  });

  it("returns the expected table names", () => {
    const snapshot: Snapshot = { tables: { one: {}, two: {} } };

    expect(loadTableNames(snapshot).sort()).toEqual(["one", "two"]);
  });
});
