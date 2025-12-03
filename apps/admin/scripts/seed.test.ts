import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureLocalMysqlUrl, main, seedTable } from "./seed";
import * as seedHelpers from "./seed-helpers";

type QueryArgs = [string, unknown[]];
type QueryMock = Mock<QueryArgs, Promise<void>>;

const mysqlMocks = vi.hoisted(() => {
  const query = vi.fn().mockResolvedValue(undefined);
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const end = vi.fn();
  const getConnection = vi.fn(() =>
    Promise.resolve({ query, release, beginTransaction, commit, rollback }),
  );
  const createPoolMock = vi.fn(() => ({ getConnection, end }));

  return {
    query,
    release,
    end,
    getConnection,
    createPoolMock,
    beginTransaction,
    commit,
    rollback,
  };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: mysqlMocks.createPoolMock },
  createPool: mysqlMocks.createPoolMock,
}));

vi.mock("./seed-helpers", async () => {
  const actual = await vi.importActual<typeof seedHelpers>("./seed-helpers");

  return {
    ...actual,
    loadSnapshot: vi
      .fn()
      .mockResolvedValue({ tables: { users: { columns: {} } } }),
    findLatestBackupDir: vi.fn().mockResolvedValue("/tmp/backups"),
    loadTableNames: vi.fn(() => ["users"]),
    loadBackupRows: vi.fn().mockResolvedValue([{ id: 1, name: "Alpha" }]),
    normalizeRowsForTable: vi.fn(() => [{ id: 1, name: "Alpha" }]),
  };
});

const { query, release, end, getConnection, createPoolMock } = mysqlMocks;
const { beginTransaction, commit, rollback } = mysqlMocks;

const createConnection = (): { query: QueryMock } => ({
  query: vi.fn<QueryArgs, Promise<void>>().mockResolvedValue(undefined),
});

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  end.mockReset();
  getConnection.mockClear();
  createPoolMock.mockClear();
  beginTransaction.mockReset();
  commit.mockReset();
  rollback.mockReset();
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const connection = createConnection();

    await seedTable(connection as never, "users", []);

    expect(connection.query).toHaveBeenCalledWith("DELETE FROM ??", ["users"]);
    expect(logSpy).toHaveBeenCalledWith("Cleared users; no rows to insert.");
  });

  it("inserts rows with nulls for missing values", async () => {
    const connection = createConnection();

    await seedTable(connection as never, "users", [
      { id: 1, name: "One" },
      { id: 2 },
    ]);

    expect(connection.query).toHaveBeenCalledWith("DELETE FROM ??", ["users"]);
    const insertArgs = connection.query.mock.calls[1]?.[1];

    expect(insertArgs).toEqual([
      "users",
      ["id", "name"],
      [
        [1, "One"],
        [2, null],
      ],
    ]);
  });

  it("skips inserts when no columns are detected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const connection = createConnection();

    await seedTable(connection as never, "users", [{} as never]);

    expect(connection.query).toHaveBeenCalledWith("DELETE FROM ??", ["users"]);
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
    expect(beginTransaction).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith("DELETE FROM ??", ["users"]);
    expect(commit).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
