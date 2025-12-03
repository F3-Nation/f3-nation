import type { PoolConnection } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attendanceExists,
  FatalError,
  findBeatdown,
  insertAttendance,
  main,
  parseArgs,
  requireEnv,
} from "./ensure-backblast-attendance";

const mysqlMocks = vi.hoisted(() => {
  const query = vi.fn();
  const execute = vi.fn();
  const beginTransaction = vi.fn();
  const commit = vi.fn();
  const rollback = vi.fn();
  const release = vi.fn();
  const end = vi.fn();
  const getConnection = vi.fn(() =>
    Promise.resolve({
      beginTransaction,
      query,
      execute,
      commit,
      rollback,
      release,
    }),
  );
  const createPoolMock = vi.fn(() => ({ getConnection, end }));

  return {
    query,
    execute,
    beginTransaction,
    commit,
    rollback,
    release,
    end,
    getConnection,
    createPoolMock,
  };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: mysqlMocks.createPoolMock },
  createPool: mysqlMocks.createPoolMock,
}));

const {
  query,
  execute,
  beginTransaction,
  commit,
  rollback,
  release,
  end,
  getConnection,
  createPoolMock,
} = mysqlMocks;

const originalArgv = [...process.argv];

beforeEach(() => {
  query.mockReset();
  execute.mockReset();
  beginTransaction.mockReset();
  commit.mockReset();
  rollback.mockReset();
  release.mockReset();
  end.mockReset();
  getConnection.mockClear();
  createPoolMock.mockClear();
  process.argv = [...originalArgv];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MYSQL_URL;
  process.argv = [...originalArgv];
});

describe("parseArgs", () => {
  it("exits when required arguments are missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit 1");
    }) as never);

    process.argv = ["node", "script.ts", "only-user"];

    expect(() => parseArgs()).toThrow("exit 1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("parses the Slack user, AO channel, and date", () => {
    process.argv = ["node", "script.ts", "U1", "C1", "2024-01-01"];

    expect(parseArgs()).toEqual({
      slackUserId: "U1",
      aoChannelId: "C1",
      date: "2024-01-01",
    });
  });
});

describe("requireEnv", () => {
  it("exits when the variable is missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit 1");
    }) as never);

    expect(() => requireEnv("MYSQL_URL")).toThrow("exit 1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("returns the variable when present", () => {
    process.env.MYSQL_URL = "mysql://localhost/db";

    expect(requireEnv("MYSQL_URL")).toBe("mysql://localhost/db");
  });
});

describe("helpers", () => {
  it("finds a beatdown when present", async () => {
    const connection = {
      query: vi.fn(() =>
        Promise.resolve([
          [
            {
              ao_id: "C123",
              bd_date: "2024-01-01",
              q_user_id: "Q1",
            },
          ],
          [],
        ]),
      ),
    };

    const beatdown = await findBeatdown(
      connection as unknown as PoolConnection,
      "C123",
      "2024-01-01",
    );

    expect(beatdown?.q_user_id).toBe("Q1");
  });

  it("returns null when no beatdown exists", async () => {
    const connection = {
      query: vi.fn(() => Promise.resolve([[], []])),
    };

    const beatdown = await findBeatdown(
      connection as unknown as PoolConnection,
      "C123",
      "2024-01-01",
    );

    expect(beatdown).toBeNull();
  });

  it("detects existing attendance", async () => {
    const connection = {
      query: vi.fn(() =>
        Promise.resolve([
          [
            {
              ao_id: "C1",
              date: "2024-01-01",
              user_id: "U1",
            },
          ],
          [],
        ]),
      ),
    };

    const exists = await attendanceExists(
      connection as unknown as PoolConnection,
      "U1",
      "C1",
      "2024-01-01",
    );

    expect(exists).toBe(true);
  });

  it("inserts attendance rows", async () => {
    const connection = {
      execute: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])),
    };

    const affected = await insertAttendance(
      connection as unknown as PoolConnection,
      "U1",
      "C1",
      "2024-01-01",
      "Q1",
    );

    expect(affected).toBe(1);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bd_attendance"),
      ["U1", "C1", "2024-01-01", "Q1"],
    );
  });
});

describe("main", () => {
  it("records attendance when a backblast exists", async () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";
    process.argv = ["node", "script.ts", "U02", "C02", "2024-01-01"];

    query.mockImplementation((sql: string) => {
      if (sql.includes("FROM beatdowns")) {
        return Promise.resolve([
          [
            {
              ao_id: "C02",
              bd_date: "2024-01-01",
              q_user_id: "Q123",
            },
          ],
          [],
        ]);
      }

      if (sql.includes("FROM bd_attendance")) {
        return Promise.resolve([[], []]);
      }

      return Promise.resolve([[], []]);
    });

    execute.mockResolvedValue([{ affectedRows: 1 }]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await main();

    expect(beginTransaction).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bd_attendance"),
      ["U02", "C02", "2024-01-01", "Q123"],
    );
    expect(commit).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it("fails when no backblast is found", async () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";
    process.argv = ["node", "script.ts", "U02", "C02", "2024-01-01"];

    query.mockResolvedValue([[], []]);

    await expect(main()).rejects.toBeInstanceOf(FatalError);

    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("fails when attendance already exists", async () => {
    process.env.MYSQL_URL = "mysql://user:pass@localhost/db";
    process.argv = ["node", "script.ts", "U02", "C02", "2024-01-01"];

    query.mockImplementation((sql: string) => {
      if (sql.includes("FROM beatdowns")) {
        return Promise.resolve([
          [
            {
              ao_id: "C02",
              bd_date: "2024-01-01",
              q_user_id: "Q123",
            },
          ],
          [],
        ]);
      }

      return Promise.resolve([
        [
          {
            ao_id: "C02",
            date: "2024-01-01",
            user_id: "U02",
          },
        ],
        [],
      ]);
    });

    await expect(main()).rejects.toBeInstanceOf(FatalError);

    expect(execute).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
