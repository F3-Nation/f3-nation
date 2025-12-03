import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureLocalMysqlUrl, main, seedTable } from "./seed";
import * as seedHelpers from "./seed-helpers";

const mysqlMocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const end = vi.fn();
  const getConnection = vi.fn(async () => ({ query, release }));
  const createPoolMock = vi.fn(() => ({ getConnection, end }));

  return { query, release, end, getConnection, createPoolMock };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: mysqlMocks.createPoolMock },
  createPool: mysqlMocks.createPoolMock,
}));

vi.mock("./seed-helpers", async () => {
  const actual =
    await vi.importActual<typeof import("./seed-helpers")>("./seed-helpers");

  return {
    ...actual,
    loadSnapshot: vi.fn(async () => ({ tables: { users: { columns: {} } } })),
    findLatestBackupDir: vi.fn(async () => "/tmp/backups"),
    loadTableNames: vi.fn(() => ["users"]),
    loadBackupRows: vi.fn(async () => [{ id: 1, name: "Alpha" }]),
    normalizeRowsForTable: vi.fn(() => [{ id: 1, name: "Alpha" }]),
  };
});

const { query, release, end, getConnection, createPoolMock } = mysqlMocks;

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  end.mockReset();
  getConnection.mockClear();
  createPoolMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MYSQL_URL;
});

describe("ensureLocalMysqlUrl", () => {
  it("rejects remote database hosts", () => {
    expect(() =>
      ensureLocalMysqlUrl("mysql://user:pass@remotehost/db"),
    ).toThrow(/local MySQL instance/);
  });
});

describe("seedTable", () => {
  it("handles empty input rows", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const connection = { query: vi.fn(async () => {}) };

    await seedTable(connection as never, "users", []);

    expect(connection.query).toHaveBeenCalledWith("TRUNCATE TABLE ??", [
      "users",
    ]);
    expect(logSpy).toHaveBeenCalledWith("Cleared users; no rows to insert.");
  });

  it("inserts rows with nulls for missing values", async () => {
    const connection = { query: vi.fn(async () => {}) };

    await seedTable(connection as never, "users", [
      { id: 1, name: "One" },
      { id: 2 },
    ]);

    expect(connection.query).toHaveBeenCalledWith("TRUNCATE TABLE ??", [
      "users",
    ]);
    const insertArgs = (connection.query as unknown as Mock).mock.calls[1][1];

    expect(insertArgs[0]).toBe("users");
    expect(insertArgs[1]).toEqual(["id", "name"]);
    expect(insertArgs[2]).toEqual([
      [1, "One"],
      [2, null],
    ]);
  });

  it("skips inserts when no columns are detected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const connection = { query: vi.fn(async () => {}) };

    await seedTable(connection as never, "users", [{} as never]);

    expect(connection.query).toHaveBeenCalledWith("TRUNCATE TABLE ??", [
      "users",
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      "Cleared users; no columns detected to insert.",
    );
  });
});

describe("main", () => {
  it("seeds each table from the latest backup", async () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";

    await main();

    expect(seedHelpers.loadSnapshot).toHaveBeenCalled();
    expect(seedHelpers.findLatestBackupDir).toHaveBeenCalled();
    expect(seedHelpers.loadTableNames).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith("TRUNCATE TABLE ??", ["users"]);
    expect(end).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
