import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backupTable,
  fetchTableRows,
  loadTableNames,
  requireEnv,
} from "./backup";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MYSQL_URL;
});

describe("backup script env helpers", () => {
  it("reads required environment variables", () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";

    expect(requireEnv("MYSQL_URL")).toBe(process.env.MYSQL_URL);
  });

  it("throws when required environment variables are missing", () => {
    delete process.env.MYSQL_URL;

    expect(() => requireEnv("MYSQL_URL")).toThrow(/MYSQL_URL is not set/);
  });
});

describe("loadTableNames", () => {
  it("parses table names from the snapshot", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      JSON.stringify({ tables: { users: {}, posts: {} } }),
    );

    const result = await loadTableNames("snapshot.json");

    expect(result.sort()).toEqual(["posts", "users"]);
  });

  it("throws when tables are missing", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      JSON.stringify({ something: {} }),
    );

    await expect(loadTableNames("snapshot.json")).rejects.toThrowError(
      /No tables found/,
    );
  });
});

describe("fetchTableRows", () => {
  it("yields rows in chunks until the source is empty", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("FROM information_schema.KEY_COLUMN_USAGE")) {
        return Promise.resolve([[{ COLUMN_NAME: "id" }], []] as const);
      }
      if (sql.includes("WHERE")) {
        return Promise.resolve([[] as unknown[], []] as const);
      }
      return Promise.resolve([[{ id: 1 }, { id: 2 }], []] as const);
    });
    const pool = { query } as unknown as Parameters<typeof fetchTableRows>[0];

    const chunks: Record<string, unknown>[][] = [];
    for await (const rows of fetchTableRows(pool, "users", 2)) {
      chunks.push(rows);
    }

    expect(chunks).toEqual([[{ id: 1 }, { id: 2 }]]);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain("information_schema");
    expect(query.mock.calls[2]?.[0]).toContain("WHERE");
  });

  it("throws when a table has no primary key", async () => {
    const query = vi.fn(() => Promise.resolve([[] as unknown[], []] as const));
    const pool = { query } as unknown as Parameters<typeof fetchTableRows>[0];

    await expect(
      (async () => {
        for await (const _ of fetchTableRows(pool, "users", 1)) {
          break;
        }
      })(),
    ).rejects.toThrow(/no primary key/);
  });
});

describe("backupTable", () => {
  it("writes table rows to disk in JSON format", async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    let whereCall = 0;
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("information_schema.KEY_COLUMN_USAGE")) {
        return Promise.resolve([[{ COLUMN_NAME: "id" }], []] as const);
      }
      if (sql.includes("WHERE")) {
        whereCall += 1;
        if (whereCall === 1) {
          return Promise.resolve([[rows[2]] as unknown[], []] as const);
        }
        return Promise.resolve([[] as unknown[], []] as const);
      }
      return Promise.resolve([[...rows.slice(0, 2)] as unknown[], []] as const);
    });
    const pool = { query } as unknown as Parameters<typeof backupTable>[0];

    const backupDir = await fs.promises.mkdtemp(path.join(tmpdir(), "backup-"));

    const count = await backupTable(pool, "users", backupDir);
    const savedRows = JSON.parse(
      await fs.promises.readFile(path.join(backupDir, "users.json"), "utf8"),
    ) as typeof rows;

    expect(count).toBe(3);
    expect(savedRows).toEqual(rows);
  });

  it("writes an empty array when no rows are returned", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ COLUMN_NAME: "id" }], []] as const)
      .mockResolvedValue([[], []] as const);
    const pool = { query } as unknown as Parameters<typeof backupTable>[0];
    const backupDir = await fs.promises.mkdtemp(
      path.join(tmpdir(), "backup-empty-"),
    );

    const count = await backupTable(pool, "users", backupDir);
    const savedRows = JSON.parse(
      await fs.promises.readFile(path.join(backupDir, "users.json"), "utf8"),
    ) as Record<string, unknown>[];

    expect(count).toBe(0);
    expect(savedRows).toEqual([]);
  });
});
