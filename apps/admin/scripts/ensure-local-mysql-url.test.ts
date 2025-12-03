import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureLocalMysqlUrl,
  ensureLocalPrivileges,
  requireEnv,
  waitForMysql,
} from "./ensure-local-mysql-url";

const mysqlMocks = vi.hoisted(() => {
  const ping = vi.fn();
  const end = vi.fn();
  const query = vi.fn();
  const createConnectionMock = vi.fn(() =>
    Promise.resolve({ ping, end, query }),
  );
  const escapeMock = vi.fn((value: unknown) => `escaped-${String(value)}`);

  return { ping, end, query, createConnectionMock, escapeMock };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: mysqlMocks.createConnectionMock,
    escape: mysqlMocks.escapeMock,
  },
  createConnection: mysqlMocks.createConnectionMock,
  escape: mysqlMocks.escapeMock,
}));

const { ping, end, query, createConnectionMock, escapeMock } = mysqlMocks;

beforeEach(() => {
  ping.mockReset();
  end.mockReset();
  query.mockReset();
  createConnectionMock.mockReset();
  escapeMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MYSQL_URL;
});

describe("requireEnv", () => {
  it("returns the env value when present", () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";

    expect(requireEnv("MYSQL_URL")).toBe(process.env.MYSQL_URL);
  });

  it("exits when the env value is missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);

    expect(() => requireEnv("MYSQL_URL")).toThrow(/exit 1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("ensureLocalMysqlUrl", () => {
  it("fails when protocol is not mysql", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);

    expect(() => ensureLocalMysqlUrl("http://localhost/db")).toThrow(/exit 1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("returns a parsed URL when the value is valid", () => {
    const url = ensureLocalMysqlUrl("mysql://user:pass@localhost/mydb");

    expect(url.hostname).toBe("localhost");
    expect(url.pathname).toBe("/mydb");
  });

  it("fails when host is not allowed", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);

    expect(() =>
      ensureLocalMysqlUrl("mysql://user:pass@remote-host/db"),
    ).toThrow(/exit 1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("waitForMysql", () => {
  it("retries until a connection succeeds", async () => {
    vi.useFakeTimers();
    createConnectionMock
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue({ ping: vi.fn(), end: vi.fn(), query: vi.fn() });

    const promise = waitForMysql(new URL("mysql://root:pass@localhost/mysql"));
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(createConnectionMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("ensureLocalPrivileges", () => {
  it("creates the database user with the expected queries", async () => {
    const connection = {
      ping: vi.fn(),
      end: vi.fn(),
      query: vi.fn(),
    };

    createConnectionMock.mockResolvedValue(connection);

    await ensureLocalPrivileges(
      new URL("mysql://tester:pw@localhost/test_db_name"),
    );

    expect(createConnectionMock).toHaveBeenCalled();
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE DATABASE IF NOT EXISTS `test_db_name`"),
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("GRANT ALL PRIVILEGES"),
    );
  });
});
