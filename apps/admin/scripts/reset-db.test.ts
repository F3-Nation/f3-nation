import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureLocalMysqlUrl, loadTableNames, main } from "./reset-db";

const mysqlMocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const end = vi.fn();
  const getConnection = vi.fn(() => Promise.resolve({ query, release }));
  const createPoolMock = vi.fn(() => ({ getConnection, end }));

  return { query, release, end, getConnection, createPoolMock };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: mysqlMocks.createPoolMock },
  createPool: mysqlMocks.createPoolMock,
}));

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
  it("rejects non-local hosts", () => {
    expect(() =>
      ensureLocalMysqlUrl("mysql://user:pass@example.com/db"),
    ).toThrow(/local MySQL instance/);
  });

  it("rejects invalid URLs", () => {
    expect(() => ensureLocalMysqlUrl("not-a-url")).toThrow(/valid URL/);
  });
});

describe("loadTableNames", () => {
  it("reads tables from the snapshot file", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      JSON.stringify({ tables: { one: {}, two: {} } }),
    );

    const tables = await loadTableNames("snapshot.json");

    expect(tables.sort()).toEqual(["one", "two"]);
  });

  it("fails when tables are missing", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(JSON.stringify({}));

    await expect(loadTableNames("snapshot.json")).rejects.toThrow(
      /No tables found/,
    );
  });
});

describe("main", () => {
  it("truncates all tables in the snapshot", async () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      JSON.stringify({ tables: { users: {}, posts: {} } }),
    );

    await main();

    expect(query).toHaveBeenCalledWith("SET FOREIGN_KEY_CHECKS=0");
    expect(query).toHaveBeenCalledWith("TRUNCATE TABLE ??", ["users"]);
    expect(query).toHaveBeenCalledWith("TRUNCATE TABLE ??", ["posts"]);
    expect(query).toHaveBeenCalledWith("SET FOREIGN_KEY_CHECKS=1");
    expect(end).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
